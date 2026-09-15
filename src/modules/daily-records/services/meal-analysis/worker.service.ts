import { Injectable, Logger } from '@nestjs/common';
import { DailyRecordKind, type Prisma } from '#generated/prisma/client.js';
import { toInputJsonValue } from '../../../../common/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import { ObjectStorageRuntime } from '../../../../common/index.js';
import { now, resolveLocale } from '../../../../common/index.js';
import {
  parseMealRecordPayload,
  toMealAnalysisHotFields,
} from '../../types/meal-analysis.types.js';
import {
  buildFailedMealAnalysis,
  normalizeMealAnalysis,
  type MealAnalysisFailureReason,
  type MealAnalysisPayload,
} from '../../schemas/meal-analysis.schema.js';
import { MEAL_ANALYSIS_DEFAULT_LOCALE } from '../../constants/meal-analysis.constants.js';
import { MealAnalysisVisionService } from './vision.service.js';

interface MealAnalysisJobData {
  userId: string;
  recordId: string;
  sourceRevision: number;
}

/**
 * 餐食分析 worker：一次多模态调用 → 落库。
 *
 * 两条不变量：
 * - **失败必须落库**：模型报错/超时/输出不可用一律写 `analysis_failed` +
 *   原因码，绝不留下永久 `analyzing`（v1 的「坏 JSON = 空结果」缺陷）。
 * - **写回前复检 revision**：`updateMany` 的 `where` 带上
 *   `mealSourceRevision`，分析期间用户再编辑（重新入队会让 revision 递增）
 *   时，本次的旧结果自动丢弃。
 */
@Injectable()
export class MealAnalysisWorkerService {
  private readonly logger = new Logger(MealAnalysisWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mealAnalysisVisionService: MealAnalysisVisionService,
    private readonly storageRuntime: ObjectStorageRuntime,
  ) {}

  async process(job: MealAnalysisJobData): Promise<void> {
    this.logger.log(
      `Meal analysis job received: recordId=${job.recordId}, revision=${String(job.sourceRevision)}`,
    );

    const record = await this.prisma.userDailyRecord.findFirst({
      where: {
        id: job.recordId,
        userId: job.userId,
        kind: DailyRecordKind.meal,
        deletedAt: null,
      },
      include: {
        attachments: {
          orderBy: { createdAt: 'asc' },
        },
        user: {
          select: { profile: { select: { locale: true } } },
        },
      },
    });
    if (record == null) {
      return;
    }

    // 幂等检查：enqueue 不使用确定性 jobId，同 revision 的冗余 job 与
    // 旧 revision 的过期 job 都靠这里跳过，去重由 worker 幂等承担。
    if (record.mealSourceRevision !== job.sourceRevision) {
      return;
    }

    const existing =
      parseMealRecordPayload(record.payload).mealAnalysis ?? null;
    if (existing?.analysisStatus !== 'analyzing') {
      return;
    }

    const locale = resolveMealLocale(record.user.profile?.locale);
    const attachment = record.attachments[0];
    if (record.attachments.length !== 1 || attachment == null) {
      await this.fail(record.id, job, locale, 'image_count_invalid');
      return;
    }

    if (!this.mealAnalysisVisionService.isConfigured()) {
      await this.fail(record.id, job, locale, 'vision_unavailable');
      return;
    }

    let signedImageUrl: string;
    try {
      signedImageUrl = await this.storageRuntime.createSignedGetUrl({
        objectKey: attachment.objectKey,
        audience: 'external',
      });
    } catch (error) {
      this.logger.error(
        `Failed to sign meal image for record ${record.id}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.fail(record.id, job, locale, 'vision_unavailable');
      return;
    }

    const outcome = await this.mealAnalysisVisionService.analyze({
      imageUrl: signedImageUrl,
      locale,
    });
    const analyzedAt = now().toISOString();

    if (!outcome.ok) {
      this.logger.warn(
        `Meal analysis failed for record ${record.id}: ${outcome.reason}`,
      );
      await this.writeAnalysis(
        record.id,
        job,
        buildFailedMealAnalysis(outcome.reason, {
          sourceRevision: job.sourceRevision,
          model: null,
          locale,
          analyzedAt,
        }),
      );
      return;
    }

    await this.writeAnalysis(
      record.id,
      job,
      normalizeMealAnalysis(outcome.draft, {
        sourceRevision: job.sourceRevision,
        model: outcome.model,
        locale,
        analyzedAt,
      }),
    );
  }

  private async fail(
    recordId: string,
    job: MealAnalysisJobData,
    locale: string,
    reason: MealAnalysisFailureReason,
  ): Promise<void> {
    this.logger.warn(
      `Meal analysis rejected for record ${recordId}: ${reason}`,
    );
    await this.writeAnalysis(
      recordId,
      job,
      buildFailedMealAnalysis(reason, {
        sourceRevision: job.sourceRevision,
        model: null,
        locale,
        analyzedAt: now().toISOString(),
      }),
    );
  }

  /**
   * 条件写：只有记录的 revision 仍是本次作业的 revision 时才落库。
   * 返回是否写入（`false` = 用户在分析期间又编辑过，本次结果作废）。
   */
  private async writeAnalysis(
    recordId: string,
    job: MealAnalysisJobData,
    analysis: MealAnalysisPayload,
  ): Promise<boolean> {
    const data: Prisma.UserDailyRecordUpdateManyMutationInput = {
      payload: toInputJsonValue({ mealAnalysis: analysis }),
      ...toMealAnalysisHotFields(analysis),
    };
    const { count } = await this.prisma.userDailyRecord.updateMany({
      where: {
        id: recordId,
        userId: job.userId,
        deletedAt: null,
        mealSourceRevision: job.sourceRevision,
      },
      data,
    });

    if (count === 0) {
      this.logger.log(
        `Discarded stale meal analysis for record ${recordId} (revision ${String(job.sourceRevision)})`,
      );
      return false;
    }
    return true;
  }
}

/** 用户未设置语言时按产品主语言兜底。 */
function resolveMealLocale(raw: string | null | undefined): string {
  return raw != null && raw.trim().length > 0
    ? resolveLocale(raw)
    : MEAL_ANALYSIS_DEFAULT_LOCALE;
}
