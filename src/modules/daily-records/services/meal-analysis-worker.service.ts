import { Injectable, Logger } from '@nestjs/common';
import { DailyRecordKind, type Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { DailyRecordImageUploadRuntime } from '../config/daily-record-image-upload.runtime';
import {
  getMealSourceRevision,
  parseMealRecordPayload,
} from '../types/meal-analysis.types';
import { MealAnalysisMatcherService } from './meal-analysis-matcher.service';
import { MealAnalysisVisionService } from './meal-analysis-vision.service';

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
    private readonly dailyRecordImageUploadRuntime: DailyRecordImageUploadRuntime,
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

    const signedImageUrl =
      this.dailyRecordImageUploadRuntime.createSignedGetUrl(
        attachment.objectKey,
      );
    const recognition =
      await this.mealAnalysisVisionService.recognizeFromImageUrl(
        signedImageUrl,
      );
    const matched = await this.mealAnalysisMatcherService.matchAndEstimate(
      recognition.foodItems,
    );
    const analyzedAt = new Date();
    const mealDescription = normalizeNullableText(recognition.mealDescription);
    const foodItems = matched.foodItems;
    const coverage = matched.coverage;

    await this.prisma.userDailyRecord.update({
      where: { id: record.id },
      data: {
        payload: {
          ...(mealPayload.mealInput != null
            ? { mealInput: mealPayload.mealInput }
            : {}),
          mealAnalysis: {
            ...(mealPayload.mealAnalysis ?? {}),
            analysisStatus: 'unconfirmed',
            coverage,
            mealDescription,
            foodItems,
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
        } as unknown as Prisma.InputJsonValue,
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
      payload: {
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
      } as unknown as Prisma.InputJsonValue,
      mealAnalysisStatus: 'analysis_failed',
      mealAnalysisFailureReason: failureReason,
    };
  }
}

function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
