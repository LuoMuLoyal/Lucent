/**
 * 餐食分析管线（应用层编排）。
 *
 * 两条不变量（worker 与回收器共用同一份实现）：
 *
 * - **失败必须落库**：模型报错/超时/输出不可用一律写 `analysis_failed` + 原因码，
 *   绝不留下永久 `analyzing`（v1 的「坏 JSON = 空结果」缺陷）。
 * - **写回前复检 revision**：条件写带上 `sourceRevision`，分析期间用户再编辑
 *   （重新入队会让 revision 递增）时，本次的旧结果自动丢弃。
 *
 * ## 依赖方向
 *
 * 只依赖 `application/ports/` 与 `domain/`：模型调用（`MealVisionModel`）、图片签名
 * （`AttachmentUrls`）、记录载入与条件写（`MealAnalyses`）都是端口；实现分别在
 * `infrastructure/llm` 与 `infrastructure/persistence`，由模块装配时注入。
 */
import { Injectable, Logger } from '@nestjs/common';
import { now, resolveLocale } from '../../../../common/index.js';
import type { DomainFailure } from '../../../../common/result/index.js';
import { MEAL_ANALYSIS_DEFAULT_LOCALE } from '../../constants/meal-analysis.constants.js';
import {
  buildFailedMealAnalysis,
  normalizeMealAnalysis,
  type MealAnalysisFailureReason,
  type MealAnalysisPayload,
} from '../../domain/meal/meal-analysis.js';
import type {
  MealAnalysisCandidate,
  StaleMealAnalysisCandidate,
} from '../../domain/meal/meal-analyses.js';
// `MealAnalyses` is an abstract class used as a constructor token, so it must be
// a value import: type-only erases it and Nest reports "can't resolve ... index [0]".
import { MealAnalyses } from '../../domain/meal/meal-analyses.js';
import { AttachmentUrls } from '../ports/attachment-urls.js';
import { MealVisionModel } from '../ports/meal-vision.js';
import type {
  AnalysisOutcome,
  MealAnalysisJob,
  ReapSettings,
} from './meal-analysis-job.js';

@Injectable()
export class MealAnalysisPipeline {
  private readonly logger = new Logger(MealAnalysisPipeline.name);

  constructor(
    private readonly analyses: MealAnalyses,
    private readonly vision: MealVisionModel,
    private readonly attachmentUrls: AttachmentUrls,
  ) {}

  /** 处理一个分析作业（worker 的唯一入口，可重复执行）。 */
  async analyze(job: MealAnalysisJob): Promise<AnalysisOutcome> {
    this.logger.log(
      `Meal analysis job received: recordId=${job.recordId}, revision=${String(job.sourceRevision)}`,
    );

    const record = await this.analyses.findCandidate(job.recordId);
    if (record == null || record.userId !== job.userId) {
      return 'skipped-missing';
    }

    // 幂等检查：入队不使用确定性 jobId，同 revision 的冗余 job 与旧 revision 的
    // 过期 job 都靠这里跳过，去重由 worker 幂等承担。
    if (record.sourceRevision !== job.sourceRevision) {
      return 'skipped-stale-revision';
    }
    if (record.analysis?.analysisStatus !== 'analyzing') {
      return 'skipped-not-analyzing';
    }

    const locale = resolveMealLocale(record.locale);

    // 恰好一张图才能分析：0 张是纯手写记录，多张无法定位。
    const objectKey = record.attachmentObjectKeys[0];
    if (record.attachmentObjectKeys.length !== 1 || objectKey == null) {
      await this.fail(record, job, locale, 'image_count_invalid');
      return 'failed';
    }
    if (!this.vision.isConfigured()) {
      await this.fail(record, job, locale, 'vision_unavailable');
      return 'failed';
    }

    let imageUrl: string;
    try {
      imageUrl = await this.attachmentUrls.signedGetUrl(objectKey);
    } catch (error) {
      this.logger.error(
        `Failed to sign meal image for record ${record.id}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.fail(record, job, locale, 'vision_unavailable');
      return 'failed';
    }

    const outcome = await this.vision.analyze({ imageUrl, locale });
    const analyzedAt = now().toISOString();

    if (outcome.isErr()) {
      const reason = failureReasonFor(outcome.error);
      this.logger.warn(
        `Meal analysis failed for record ${record.id}: ${reason} (${outcome.error.code})`,
      );
      const written = await this.writeFailure(
        record.id,
        job,
        buildFailedMealAnalysis(reason, {
          sourceRevision: job.sourceRevision,
          model: null,
          locale,
          analyzedAt,
        }),
      );
      return written ? 'failed' : 'discarded';
    }

    const written = await this.writeAnalysis(
      record.id,
      job,
      normalizeMealAnalysis(outcome.value.draft, {
        sourceRevision: job.sourceRevision,
        model: outcome.value.model,
        locale,
        analyzedAt,
      }),
    );
    return written ? 'analyzed' : 'discarded';
  }

  /**
   * 回收停留在 `analyzing` 的记录。
   *
   * 单次模型调用有时间上限，正常作业不可能长时间停在 `analyzing`：停留说明作业
   * 已经丢失（进程崩溃、队列丢单、Redis 数据被清）。落成
   * `analysis_failed(job_lost)`，用户的详情页才会出现「重新分析」入口。
   *
   * **刻意不复用 `model_timeout`**：本流程判定的是「作业没跑完就没了」，不是
   * 「模型调用超时」——混成一个码会让真正的模型超时告警被基础设施故障淹没。
   */
  async reapStale(settings: ReapSettings): Promise<number> {
    const staleBefore = new Date(now().getTime() - settings.staleAfterMs);
    const candidates = await this.analyses.listStaleAnalyzing(
      staleBefore,
      settings.batchSize,
    );

    let reaped = 0;
    for (const candidate of candidates) {
      if (await this.reapOne(candidate)) {
        reaped += 1;
      }
    }

    if (reaped > 0) {
      this.logger.warn(
        `Reaped ${String(reaped)} stale meal analyses as job_lost`,
      );
    }
    return reaped;
  }

  private reapOne(candidate: StaleMealAnalysisCandidate): Promise<boolean> {
    return this.analyses.markAnalysisFailed(
      candidate.id,
      candidate.sourceRevision,
      buildFailedMealAnalysis('job_lost', {
        sourceRevision: candidate.sourceRevision,
        model: null,
        locale: candidate.locale ?? MEAL_ANALYSIS_DEFAULT_LOCALE,
        analyzedAt: now().toISOString(),
      }),
    );
  }

  private async fail(
    record: MealAnalysisCandidate,
    job: MealAnalysisJob,
    locale: string,
    reason: MealAnalysisFailureReason,
  ): Promise<boolean> {
    this.logger.warn(
      `Meal analysis rejected for record ${record.id}: ${reason}`,
    );
    return this.writeFailure(
      record.id,
      job,
      buildFailedMealAnalysis(reason, {
        sourceRevision: job.sourceRevision,
        model: null,
        locale,
        analyzedAt: now().toISOString(),
      }),
    );
  }

  /** 条件写成功结果：只有 revision 仍是本次作业的 revision 时才落库。 */
  private writeAnalysis(
    recordId: string,
    job: MealAnalysisJob,
    analysis: MealAnalysisPayload,
  ): Promise<boolean> {
    return this.analyses
      .writeAnalysis(recordId, job.sourceRevision, analysis)
      .then((written) => this.report(recordId, job, written));
  }

  private writeFailure(
    recordId: string,
    job: MealAnalysisJob,
    analysis: MealAnalysisPayload,
  ): Promise<boolean> {
    return this.analyses
      .markAnalysisFailed(recordId, job.sourceRevision, analysis)
      .then((written) => this.report(recordId, job, written));
  }

  private report(
    recordId: string,
    job: MealAnalysisJob,
    written: boolean,
  ): boolean {
    if (!written) {
      this.logger.log(
        `Discarded stale meal analysis for record ${recordId} (revision ${String(job.sourceRevision)})`,
      );
    }
    return written;
  }
}

/** 用户未设置语言时按产品主语言兜底。 */
function resolveMealLocale(raw: string | null | undefined): string {
  return raw != null && raw.trim().length > 0
    ? resolveLocale(raw)
    : MEAL_ANALYSIS_DEFAULT_LOCALE;
}

/**
 * 依赖失败码 → 落库失败原因码（客户端按后者做 l10n）。
 *
 * 落库词汇比传输词汇窄：客户端只需要「是超时、还是模型不可用、还是输出不可用」。
 */
function failureReasonFor(failure: DomainFailure): MealAnalysisFailureReason {
  switch (failure.code) {
    case 'DEPENDENCY_TIMEOUT':
      return 'model_timeout';
    case 'DEPENDENCY_BAD_GATEWAY':
      return 'invalid_output';
    default:
      return 'model_failed';
  }
}
