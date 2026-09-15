import { Injectable } from '@nestjs/common';
import { DailyRecordKind, Prisma } from '#generated/prisma/client.js';
import { toInputJsonValue } from '../../../common/index.js';
import {
  buildMealPayloadFromClientInput,
  getMealSourceRevision,
  markMealAnalysisQueued,
  parseMealRecordPayload,
  toMealAnalysisHotFields,
} from '../types/meal-analysis.types.js';
import type {
  MealAnalysisFailureReason,
  MealAnalysisStatus,
} from '../schemas/meal-analysis.schema.js';
import { MealAnalysisQueueService } from './meal-analysis/queue.service.js';

/**
 * Meal-payload write path: sanitizes the client-editable dish list, folds the
 * one-image analysis queue marker (plus hot columns) into the stored payload,
 * and decides whether a meal analysis job should be enqueued after a write.
 *
 * 状态由服务端独占：客户端的提交只能改 `dishes`，`analysisStatus` 永远由
 * 入队（analyzing）与 worker（analyzed / analysis_failed）写。
 */
@Injectable()
export class MealPayloadWriterService {
  constructor(
    private readonly mealAnalysisQueueService: MealAnalysisQueueService,
  ) {}

  public prepareMealPayloadForWrite(
    payload: unknown,
    attachments: { objectKey: string }[] | undefined,
    existingPayload?: unknown,
  ): Record<string, unknown> | null {
    const sanitized = buildMealPayloadFromClientInput(
      payload,
      existingPayload ?? null,
    );
    // 恰好一张图才会分析（0 张是纯手写记录，多张无法分析）。
    if (attachments == null || attachments.length !== 1) {
      return sanitized;
    }

    return markMealAnalysisQueued(sanitized);
  }

  public withMealHotFields(
    data: Prisma.UserDailyRecordUpdateInput,
    mealPayload: Record<string, unknown> | null,
  ): Prisma.UserDailyRecordUpdateInput {
    if (mealPayload == null) {
      return data;
    }

    return {
      ...data,
      payload: toInputJsonValue(mealPayload),
      ...this.extractMealAnalysisHotFields(mealPayload),
    };
  }

  /** Expands a prepared meal payload into full create-data (payload + hot columns). */
  public toCreateFields(
    mealPayload: Record<string, unknown> | null,
  ): Record<string, unknown> {
    if (mealPayload == null) {
      return {};
    }

    const hotFields = this.extractMealAnalysisHotFields(mealPayload);
    return {
      payload: mealPayload,
      mealAnalysisStatus: hotFields.mealAnalysisStatus,
      mealAnalysisCoverage: hotFields.mealAnalysisCoverage,
      mealSourceRevision: hotFields.mealSourceRevision,
    };
  }

  private extractMealAnalysisHotFields(mealPayload: Record<string, unknown>): {
    mealAnalysisStatus: MealAnalysisStatus | null;
    mealAnalysisCoverage: null;
    mealAnalysisUpdatedAt: Date | null;
    mealAnalysisFailureReason: MealAnalysisFailureReason | null;
    mealSourceRevision: number;
  } {
    return toMealAnalysisHotFields(
      parseMealRecordPayload(mealPayload).mealAnalysis ?? null,
    );
  }

  /**
   * 复检 payload 里是否仍是待分析状态并仍是同一 revision，是则入队。
   *
   * `sourceRevisionOverride` 用于「写完再过一遍」的路径（新建/替换图片），
   * 那里 payload 已经在事务里写过，不能靠 status 判断。
   */
  public async enqueueAnalysisIfNeeded(
    userId: string,
    item: {
      id: string;
      kind: DailyRecordKind;
      attachments: Array<{ objectKey: string }>;
      payload?: Record<string, unknown> | null;
    },
    sourceRevisionOverride?: number,
  ): Promise<void> {
    if (item.kind !== DailyRecordKind.meal || item.attachments.length !== 1) {
      return;
    }

    if (sourceRevisionOverride != null) {
      await this.mealAnalysisQueueService.enqueue({
        userId,
        recordId: item.id,
        sourceRevision: sourceRevisionOverride,
      });
      return;
    }

    const analysis = item.payload?.['mealAnalysis'] as
      | Record<string, unknown>
      | undefined;
    if (analysis?.['analysisStatus'] !== 'analyzing') {
      return;
    }

    await this.mealAnalysisQueueService.enqueue({
      userId,
      recordId: item.id,
      sourceRevision: getMealSourceRevision(item.payload),
    });
  }
}
