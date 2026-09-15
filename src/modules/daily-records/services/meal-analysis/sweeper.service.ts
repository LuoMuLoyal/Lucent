import { Injectable, Logger } from '@nestjs/common';
import { DailyRecordKind } from '#generated/prisma/client.js';
import { toInputJsonValue } from '../../../../common/index.js';
import { now } from '../../../../common/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  MEAL_ANALYSIS_DEFAULT_LOCALE,
  MEAL_ANALYSIS_REAP_BATCH_SIZE,
  MEAL_ANALYSIS_STALE_AFTER_MS,
} from '../../constants/meal-analysis.constants.js';
import { buildFailedMealAnalysis } from '../../schemas/meal-analysis.schema.js';
import {
  parseMealRecordPayload,
  toMealAnalysisHotFields,
} from '../../types/meal-analysis.types.js';

/**
 * `analyzing` 过期回收（cron 每 5 分钟一次）。
 *
 * 单次模型调用有时间上限，正常作业不可能长时间停在 `analyzing`：停留说明作业
 * 已经丢失（进程崩溃、队列丢单、Redis 数据被清）。这里把它们落成
 * `analysis_failed(model_timeout)`，用户的详情页才会出现「重新分析」入口——
 * 否则记录会永远停在「分析中」且没有任何补救手段（v1 的缺陷）。
 */
@Injectable()
export class MealAnalysisSweeperService {
  private readonly logger = new Logger(MealAnalysisSweeperService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reapStaleAnalyses(): Promise<number> {
    const staleBefore = new Date(Date.now() - MEAL_ANALYSIS_STALE_AFTER_MS);
    const candidates = await this.prisma.userDailyRecord.findMany({
      where: {
        kind: DailyRecordKind.meal,
        deletedAt: null,
        mealAnalysisStatus: 'analyzing',
        updatedAt: { lt: staleBefore },
      },
      select: { id: true, userId: true, payload: true },
      take: MEAL_ANALYSIS_REAP_BATCH_SIZE,
    });

    let reaped = 0;
    for (const candidate of candidates) {
      const analysis =
        parseMealRecordPayload(candidate.payload).mealAnalysis ?? null;
      if (analysis?.analysisStatus !== 'analyzing') {
        continue;
      }

      const failed = buildFailedMealAnalysis('model_timeout', {
        sourceRevision: analysis.sourceRevision,
        model: null,
        locale: analysis.locale ?? MEAL_ANALYSIS_DEFAULT_LOCALE,
        analyzedAt: now().toISOString(),
      });

      const { count } = await this.prisma.userDailyRecord.updateMany({
        where: {
          id: candidate.id,
          userId: candidate.userId,
          deletedAt: null,
          mealAnalysisStatus: 'analyzing',
          mealSourceRevision: analysis.sourceRevision,
        },
        data: {
          payload: toInputJsonValue({ mealAnalysis: failed }),
          ...toMealAnalysisHotFields(failed),
        },
      });
      reaped += count;
    }

    if (reaped > 0) {
      this.logger.warn(
        `Reaped ${String(reaped)} stale meal analyses as model_timeout`,
      );
    }
    return reaped;
  }
}
