import { Injectable, Logger } from '@nestjs/common';
import { DailyRecordKind, type Prisma } from '#generated/prisma/client.js';
import { normalizeNullableText } from '../../../../common/index.js';
import { toInputJsonValue } from '../../../../common/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import { ObjectStorageRuntime } from '../../../../common/index.js';
import {
  getMealSourceRevision,
  parseMealRecordPayload,
} from '../../types/meal-analysis.types.js';
import { MealAnalysisMatcherService } from '../meal-analysis/matcher.service.js';
import { MealAnalysisVisionService } from '../meal-analysis/vision.service.js';
import { now } from '../../../../common/index.js';

interface MealAnalysisJobData {
  userId: string;
  recordId: string;
  sourceRevision: number;
}

@Injectable()
export class MealAnalysisWorkerService {
  private readonly logger = new Logger(MealAnalysisWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mealAnalysisVisionService: MealAnalysisVisionService,
    private readonly storageRuntime: ObjectStorageRuntime,
    private readonly mealAnalysisMatcherService: MealAnalysisMatcherService,
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

    const mealPayload = parseMealRecordPayload(record.payload);
    if (getMealSourceRevision(record.payload) !== job.sourceRevision) {
      return;
    }

    if (record.attachments.length !== 1) {
      await this.prisma.userDailyRecord.update({
        where: { id: record.id },
        data: this.buildFailureUpdate(
          mealPayload,
          'Meal analysis requires exactly one image attachment.',
        ),
      });
      return;
    }

    if (!this.mealAnalysisVisionService.isConfigured()) {
      await this.prisma.userDailyRecord.update({
        where: { id: record.id },
        data: this.buildFailureUpdate(
          mealPayload,
          'Meal analysis vision model is not configured.',
        ),
      });
      return;
    }

    const attachment = record.attachments[0];
    if (attachment == null) {
      await this.prisma.userDailyRecord.update({
        where: { id: record.id },
        data: this.buildFailureUpdate(
          mealPayload,
          'Meal analysis requires exactly one image attachment.',
        ),
      });
      return;
    }

    const signedImageUrl = await this.storageRuntime.createSignedGetUrl({
      objectKey: attachment.objectKey,
      audience: 'external',
    });
    const recognition =
      await this.mealAnalysisVisionService.recognizeFromImageUrl(
        signedImageUrl,
      );
    const matched = await this.mealAnalysisMatcherService.matchAndEstimate(
      recognition.foodItems,
    );
    const analyzedAt = now();
    const mealDescription = normalizeNullableText(recognition.mealDescription);
    const foodItems = matched.foodItems;
    const coverage = matched.coverage;

    await this.prisma.userDailyRecord.update({
      where: { id: record.id },
      data: {
        payload: toInputJsonValue({
          ...(mealPayload.mealInput != null
            ? { mealInput: mealPayload.mealInput }
            : {}),
          mealAnalysis: {
            ...(mealPayload.mealAnalysis ?? {}),
            analysisStatus: 'unconfirmed',
            coverage,
            mealDescription,
            foodItems,
            recognizedDishes: matched.recognizedDishes,
            resolvedIngredients: matched.resolvedIngredients,
            compositionMatches: matched.compositionMatches,
            nutritionEstimate: matched.nutritionEstimate,
            mealCommentary: matched.mealCommentary,
            matchDiagnostics: matched.matchDiagnostics,
            failureReason: null,
            analyzedAt: analyzedAt.toISOString(),
            imageObjectKey:
              mealPayload.mealAnalysis?.imageObjectKey ?? attachment.objectKey,
            sourceRevision: job.sourceRevision,
          },
          ...(mealPayload.mealAnalysisLastConfirmed != null
            ? {
                mealAnalysisLastConfirmed:
                  mealPayload.mealAnalysisLastConfirmed,
              }
            : {}),
        }),
        mealAnalysisStatus: 'unconfirmed',
        mealAnalysisCoverage: coverage,
        mealAnalysisUpdatedAt: analyzedAt,
        mealAnalysisFailureReason: null,
      },
    });
  }

  private buildFailureUpdate(
    mealPayload: ReturnType<typeof parseMealRecordPayload>,
    failureReason: string,
  ): Prisma.UserDailyRecordUpdateInput {
    return {
      payload: toInputJsonValue({
        ...(mealPayload.mealInput != null
          ? { mealInput: mealPayload.mealInput }
          : {}),
        mealAnalysis: {
          ...(mealPayload.mealAnalysis ?? {}),
          analysisStatus: 'analysis_failed',
          failureReason,
        },
        ...(mealPayload.mealAnalysisLastConfirmed != null
          ? { mealAnalysisLastConfirmed: mealPayload.mealAnalysisLastConfirmed }
          : {}),
      }),
      mealAnalysisStatus: 'analysis_failed',
      mealAnalysisCoverage: null,
      mealAnalysisUpdatedAt: now(),
      mealAnalysisFailureReason: failureReason,
    };
  }
}
