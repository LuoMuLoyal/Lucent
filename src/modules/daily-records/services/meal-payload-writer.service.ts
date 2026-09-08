import { Injectable } from '@nestjs/common';
import { DailyRecordKind, Prisma } from '#generated/prisma/client.js';
import { toInputJsonValue } from '../../../common/index.js';
import {
  buildMealPayloadFromClientInput,
  getMealSourceRevision,
  markMealAnalysisQueued,
  parseMealRecordPayload,
  type MealAnalysisCoverage,
  type MealAnalysisStatus,
} from '../types/meal-analysis.types.js';
import { MealAnalysisQueueService } from './meal-analysis/queue.service.js';

/**
 * Meal-payload write path: sanitizes client meal input, folds the one-image
 * analysis queue marker (plus hot columns) into the stored payload, and
 * decides whether a meal analysis job should be enqueued after a write.
 *
 * Extracted from `DailyRecordsService` so the record CRUD service stays
 * focused on orchestration and the meal-analysis contract lives in one file.
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
  ) {
    const sanitized = buildMealPayloadFromClientInput(
      payload,
      existingPayload ?? null,
    );
    if (attachments == null || attachments.length !== 1) {
      return sanitized;
    }
    const attachment = attachments[0];
    if (attachment == null) {
      return sanitized;
    }

    return markMealAnalysisQueued(sanitized, {
      imageObjectKey: attachment.objectKey,
    });
  }

  /** Marks a dish-edited payload as needing re-analysis when an image exists. */
  public requeueOnDishChange(
    finalPayload: Record<string, unknown>,
  ): Record<string, unknown> {
    const currentAnalysis = finalPayload['mealAnalysis'] as
      | Record<string, unknown>
      | undefined;
    const imageObjectKey =
      typeof currentAnalysis?.['imageObjectKey'] === 'string'
        ? currentAnalysis['imageObjectKey']
        : null;
    if (imageObjectKey != null) {
      return markMealAnalysisQueued(finalPayload, { imageObjectKey });
    }
    return finalPayload;
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

  private buildMealCreateFields(
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

  /** Expands a prepared meal payload into full create-data (payload + hot columns). */
  public toCreateFields(
    mealPayload: Record<string, unknown> | null,
  ): Record<string, unknown> {
    return this.buildMealCreateFields(mealPayload);
  }

  private extractMealAnalysisHotFields(mealPayload: Record<string, unknown>): {
    mealAnalysisStatus: MealAnalysisStatus | null;
    mealAnalysisCoverage: MealAnalysisCoverage | null;
    mealAnalysisUpdatedAt: Date | null;
    mealAnalysisFailureReason: string | null;
    mealSourceRevision: number;
  } {
    const analysis = mealPayload['mealAnalysis'] as
      | Record<string, unknown>
      | undefined;
    return {
      mealAnalysisStatus:
        (analysis?.['analysisStatus'] as
          | MealAnalysisStatus
          | null
          | undefined) ?? null,
      mealAnalysisCoverage:
        (analysis?.['coverage'] as MealAnalysisCoverage | null | undefined) ??
        null,
      mealAnalysisUpdatedAt:
        typeof analysis?.['analyzedAt'] === 'string'
          ? new Date(analysis['analyzedAt'])
          : null,
      mealAnalysisFailureReason:
        (analysis?.['failureReason'] as string | null | undefined) ?? null,
      mealSourceRevision: getMealSourceRevision(mealPayload),
    };
  }

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

  /** Parses the stored payload's mealAnalysis for the dish-learning step. */
  public parseAnalysis(item: { payload?: Record<string, unknown> | null }) {
    return parseMealRecordPayload(item.payload).mealAnalysis;
  }
}
