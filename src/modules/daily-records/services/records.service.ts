import { normalizeNullableText } from '../../../common';
import { parseDateOnly, now, formatDateOnly } from '../../../common';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { badRequest } from '../../../common';
import { DailyRecordKind, Prisma } from '#generated/prisma/client';
import { toInputJsonValue } from '../../../common';
import type { CreateDailyRecordDto } from '../dto/create-record.dto';
import type { UpdateDailyRecordDto } from '../dto/update-record.dto';
import { DailyRecordsOwnershipService } from './ownership.service';
import { DailyRecordsMapperService } from './mapper.service';
import {
  dailyRecordWithAttachments,
  type OwnedRecordSnapshot,
} from '../types/record.types';
import {
  buildConfirmedMealPayload,
  buildMealPayloadFromClientInput,
  getMealSourceRevision,
  hasMealDishInputChanges,
  isMealAnalysisConfirmRequest,
  markMealAnalysisQueued,
  parseMealRecordPayload,
  type MealAnalysisCoverage,
  type MealAnalysisStatus,
} from '../types/meal-analysis.types';
import { MealAnalysisQueueService } from './meal-analysis/queue.service';
import { MealDishTemplateLearningService } from './meal-dish/template-learning.service';
import { DailyRecordRepositoryPort } from '../repositories/daily-record.repository';
import { HealthEventsOwnershipService } from '../../health-events';
import {
  DAILY_RECORD_CHANGED,
  type DailyRecordChangedPayload,
} from '../../../common/events/domain-events.js';

@Injectable()
export class DailyRecordsService {
  private readonly logger = new Logger(DailyRecordsService.name);

  constructor(
    private readonly repository: DailyRecordRepositoryPort,
    private readonly ownershipService: DailyRecordsOwnershipService,
    private readonly healthEventsOwnershipService: HealthEventsOwnershipService,
    private readonly mapperService: DailyRecordsMapperService,
    private readonly mealAnalysisQueueService: MealAnalysisQueueService,
    private readonly mealDishTemplateLearningService: MealDishTemplateLearningService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async list(
    userId: string,
    date: string,
    kind?: string,
    page = 1,
    pageSize = 50,
  ) {
    const result = await this.repository.findManyWithAttachments(
      {
        userId,
        occurredAt: parseDateOnly(date),
        ...(kind != null ? { kind: kind as DailyRecordKind } : {}),
      },
      { page, pageSize },
    );

    return {
      items: result.items.map((record) => this.mapperService.toItem(record)),
      total: result.total,
    };
  }

  async create(userId: string, dto: CreateDailyRecordDto) {
    this.ensureValidSleepPayload(dto.kind, dto.payload);
    this.ensureValidVitalPayload(dto.kind, dto.payload);
    this.ensureValidActivityPayload(dto.kind, dto.payload);

    const healthEventId = dto.healthEventId ?? null;
    if (healthEventId !== null) {
      await this.healthEventsOwnershipService.ensureActiveOwnedByUser(
        userId,
        healthEventId,
      );
    }

    const createAttachments = dto.attachments;
    const initialMealPayload =
      dto.kind === DailyRecordKind.meal
        ? this.prepareMealPayloadForWrite(dto.payload, createAttachments)
        : null;

    const baseData = {
      userId,
      kind: dto.kind,
      occurredAt: parseDateOnly(dto.occurredAt),
      occurredTime: normalizeNullableText(dto.occurredTime),
      title: normalizeNullableText(dto.title),
      value: normalizeNullableText(dto.value),
      unit: normalizeNullableText(dto.unit),
      note: normalizeNullableText(dto.note),
      source: dto.source ?? 'manual',
      healthEventId,
    };

    const payloadField =
      dto.kind === DailyRecordKind.meal
        ? this.buildMealCreateFields(initialMealPayload)
        : dto.payload === undefined
          ? {}
          : { payload: toInputJsonValue(dto.payload) };

    if (createAttachments !== undefined && createAttachments.length > 0) {
      const item = await this.repository.transaction(async (tx) => {
        const record = await tx.userDailyRecord.create({
          data: { ...baseData, ...payloadField },
        });
        let queuedRevision: number | null = null;
        await tx.userDailyRecordAttachment.createMany({
          data: this.mapperService.toAttachmentCreateManyData(
            userId,
            record.id,
            createAttachments,
          ),
        });
        if (
          dto.kind === DailyRecordKind.meal &&
          createAttachments.length === 1
        ) {
          const attachment = createAttachments[0];
          if (attachment == null) {
            throw new Error('Expected one meal attachment after length check.');
          }
          const queuedPayload = markMealAnalysisQueued(record.payload, {
            imageObjectKey: attachment.objectKey,
          });
          queuedRevision = getMealSourceRevision(queuedPayload);
          await tx.userDailyRecord.update({
            where: { id: record.id },
            data: this.withMealHotFields({}, queuedPayload),
          });
        }
        const txItem = await this.getItemFromTx(tx, userId, record.id);
        return { item: txItem, queuedRevision };
      });

      await this.enqueueMealAnalysisIfNeeded(
        userId,
        item.item,
        item.queuedRevision ?? undefined,
      );
      await this.invalidateSuggestionCache(
        userId,
        dto.occurredAt,
        dto.kind,
        item.item.id,
      );
      return item.item;
    }

    const record = await this.repository.create({
      ...baseData,
      ...payloadField,
    });

    const item = this.mapperService.toItem(record, {
      includeMealPayload: true,
    });
    await this.enqueueMealAnalysisIfNeeded(userId, item);
    await this.invalidateSuggestionCache(
      userId,
      dto.occurredAt,
      dto.kind,
      item.id,
    );
    return item;
  }

  async get(userId: string, id: string) {
    const record = await this.repository.findByIdWithAttachments(userId, id);
    if (record == null) {
      this.ownershipService.throwRecordNotFound();
    }
    return this.mapperService.toItem(record, { includeMealPayload: true });
  }

  async update(userId: string, id: string, dto: UpdateDailyRecordDto) {
    const existing = await this.ownershipService.ensureOwnedByUser(userId, id);
    if (dto.healthEventId !== undefined && dto.healthEventId !== null) {
      await this.healthEventsOwnershipService.ensureActiveOwnedByUser(
        userId,
        dto.healthEventId,
      );
    }
    this.ensureValidSleepFinalState(dto, existing);
    const isMealTarget = (dto.kind ?? existing.kind) === DailyRecordKind.meal;
    const confirmRequested =
      isMealTarget && dto.payload !== undefined
        ? isMealAnalysisConfirmRequest(dto.payload)
        : false;

    const updateAttachments = dto.attachments;
    let nextPayload =
      (dto.payload !== undefined || updateAttachments !== undefined) &&
      isMealTarget
        ? this.prepareMealPayloadForWrite(
            dto.payload !== undefined ? dto.payload : existing.payload,
            updateAttachments,
            existing.payload,
          )
        : null;

    const dishInputChanged =
      isMealTarget && dto.payload !== undefined
        ? hasMealDishInputChanges(nextPayload, existing.payload)
        : false;

    if (isMealTarget && confirmRequested) {
      nextPayload = buildConfirmedMealPayload(nextPayload);
    } else if (
      isMealTarget &&
      dishInputChanged &&
      updateAttachments === undefined &&
      nextPayload != null
    ) {
      const currentAnalysis = nextPayload['mealAnalysis'] as
        | Record<string, unknown>
        | undefined;
      const imageObjectKey =
        typeof currentAnalysis?.['imageObjectKey'] === 'string'
          ? currentAnalysis['imageObjectKey']
          : null;
      if (imageObjectKey != null) {
        nextPayload = markMealAnalysisQueued(nextPayload, { imageObjectKey });
      }
    }

    if (updateAttachments !== undefined) {
      const item = await this.repository.transaction(async (tx) => {
        await tx.userDailyRecord.update({
          where: { id },
          data: this.withMealHotFields(
            this.mapperService.toRecordUpdateData(dto, existing),
            nextPayload,
          ),
        });
        await tx.userDailyRecordAttachment.deleteMany({
          where: { userId, recordId: id },
        });
        if (updateAttachments.length > 0) {
          await tx.userDailyRecordAttachment.createMany({
            data: this.mapperService.toAttachmentCreateManyData(
              userId,
              id,
              updateAttachments,
            ),
          });
        }
        return this.getItemFromTx(tx, userId, id);
      });

      if (confirmRequested) {
        await this.mealDishTemplateLearningService.learnFromConfirmedAnalysis(
          parseMealRecordPayload(item.payload).mealAnalysis,
        );
      }
      await this.enqueueMealAnalysisIfNeeded(
        userId,
        item,
        nextPayload == null ? undefined : getMealSourceRevision(nextPayload),
      );
      await this.invalidateSuggestionCacheForUpdate(userId, id, existing, dto);
      return item;
    }

    const record = await this.repository.update(
      id,
      this.withMealHotFields(
        this.mapperService.toRecordUpdateData(dto, existing),
        nextPayload,
      ),
    );

    const item = this.mapperService.toItem(record, {
      includeMealPayload: true,
    });
    if (confirmRequested) {
      await this.mealDishTemplateLearningService.learnFromConfirmedAnalysis(
        parseMealRecordPayload(item.payload).mealAnalysis,
      );
      await this.invalidateSuggestionCacheForUpdate(userId, id, existing, dto);
      return item;
    }
    await this.enqueueMealAnalysisIfNeeded(userId, item);
    await this.invalidateSuggestionCacheForUpdate(userId, id, existing, dto);
    return item;
  }

  async delete(userId: string, id: string) {
    const existing = await this.ownershipService.ensureOwnedByUser(userId, id);
    await this.repository.softDelete(id, now());
    if (existing.occurredAt != null) {
      await this.invalidateSuggestionCache(
        userId,
        existing.occurredAt,
        existing.kind,
        id,
      );
    }
  }

  async summary(userId: string, date: string) {
    const records = await this.repository.findManyByDateWithAttachments(
      userId,
      parseDateOnly(date),
    );

    return this.mapperService.toSummaries(records);
  }

  private async invalidateSuggestionCache(
    userId: string,
    occurredAt: string | Date,
    kind?: DailyRecordKind,
    recordId?: string,
  ): Promise<void> {
    try {
      const dateStr =
        typeof occurredAt === 'string'
          ? formatDateOnly(parseDateOnly(occurredAt))
          : formatDateOnly(occurredAt);
      await this.eventEmitter.emitAsync(DAILY_RECORD_CHANGED, {
        userId,
        date: dateStr,
        ...(kind != null ? { kind } : {}),
        ...(recordId != null ? { recordId } : {}),
      } satisfies DailyRecordChangedPayload);
    } catch (error) {
      // cache invalidation is best-effort
      this.logger.warn('Failed to emit daily-record.changed event', {
        userId,
        error,
      });
    }
  }

  /**
   * Invalidates the suggestion cache for both the record's previous date and
   * its new date, since an update may move a record across days. Without this,
   * the destination day would keep serving stale signals until the TTL.
   */
  private async invalidateSuggestionCacheForUpdate(
    userId: string,
    recordId: string,
    existing: OwnedRecordSnapshot,
    dto: UpdateDailyRecordDto,
  ): Promise<void> {
    try {
      const previousDate =
        existing.occurredAt != null
          ? formatDateOnly(existing.occurredAt)
          : null;
      const nextDate =
        dto.occurredAt !== undefined
          ? formatDateOnly(parseDateOnly(dto.occurredAt))
          : previousDate;
      const nextKind = dto.kind ?? existing.kind;
      const events = new Map<string, DailyRecordChangedPayload>();

      if (previousDate != null) {
        events.set(`${previousDate}:${existing.kind}`, {
          userId,
          date: previousDate,
          kind: existing.kind,
          recordId,
        });
      }
      if (nextDate != null) {
        events.set(`${nextDate}:${nextKind}`, {
          userId,
          date: nextDate,
          kind: nextKind,
          recordId,
        });
      }

      for (const event of events.values()) {
        await this.eventEmitter.emitAsync(DAILY_RECORD_CHANGED, event);
      }
    } catch (error) {
      // cache invalidation is best-effort
      this.logger.warn('Failed to emit daily-record.changed event', {
        userId,
        error,
      });
    }
  }

  private validateSleepPayload(
    payload: Record<string, unknown> | null | undefined,
  ): void {
    if (payload == null) {
      badRequest(
        'Sleep records require payload.durationMinutes as a positive number.',
      );
    }

    // Quick-entry sleep flow creates temporary start/wake event records first,
    // then merges them into a final sleep record with durationMinutes. Allow
    // those temporary event records to skip the duration validation.
    const sleepEvent = payload['sleepEvent'];
    if (sleepEvent === 'start' || sleepEvent === 'wake') {
      return;
    }

    if (
      payload['sleepType'] !== undefined &&
      payload['sleepType'] !== 'nightSleep' &&
      payload['sleepType'] !== 'nap'
    ) {
      badRequest('Sleep payload.sleepType must be nightSleep or nap.');
    }
    if (
      payload['quality'] !== undefined &&
      typeof payload['quality'] !== 'string'
    ) {
      badRequest('Sleep payload.quality must be a string.');
    }

    const startedAt = payload['startedAt'] ?? payload['startAt'];
    const endedAt = payload['endedAt'] ?? payload['endAt'];
    if ((startedAt == null) !== (endedAt == null)) {
      badRequest('Sleep payload requires both startedAt and endedAt.');
    }
    if (startedAt != null && endedAt != null) {
      if (typeof startedAt !== 'string' || typeof endedAt !== 'string') {
        badRequest(
          'Sleep payload startedAt and endedAt must be ISO timestamps.',
        );
      }
      const started = new Date(startedAt);
      const ended = new Date(endedAt);
      if (
        Number.isNaN(started.getTime()) ||
        Number.isNaN(ended.getTime()) ||
        ended.getTime() <= started.getTime()
      ) {
        badRequest('Sleep payload.endedAt must be later than startedAt.');
      }
    }

    if (
      typeof payload['durationMinutes'] !== 'number' ||
      !Number.isFinite(payload['durationMinutes'])
    ) {
      badRequest(
        'Sleep records require payload.durationMinutes as a positive number.',
      );
    }
    if (payload['durationMinutes'] <= 0) {
      badRequest('Sleep payload.durationMinutes must be a positive number.');
    }
  }

  private ensureValidSleepPayload(
    kind: string,
    payload: Record<string, unknown> | undefined,
  ) {
    if (kind !== DailyRecordKind.sleep) return;
    this.validateSleepPayload(payload);
  }

  private ensureValidSleepFinalState(
    dto: UpdateDailyRecordDto,
    existing: { kind: DailyRecordKind; payload: unknown },
  ) {
    const finalKind = dto.kind !== undefined ? dto.kind : existing.kind;
    if (finalKind !== DailyRecordKind.sleep) return;

    const rawPayload =
      dto.payload !== undefined ? dto.payload : existing.payload;
    const payload = rawPayload as Record<string, unknown> | null;

    this.validateSleepPayload(payload);
  }

  private ensureValidVitalPayload(
    kind: string,
    payload: Record<string, unknown> | undefined,
  ) {
    if (kind !== DailyRecordKind.vital) return;
    if (payload == null) return;
    if (typeof payload['vitalType'] !== 'string') {
      badRequest('Vital records require payload.vitalType.');
    }
    if (typeof payload['value'] !== 'number') {
      badRequest('Vital records require payload.value as a number.');
    }
  }

  private ensureValidActivityPayload(
    kind: string,
    payload: Record<string, unknown> | undefined,
  ) {
    if (kind !== DailyRecordKind.activity) return;
    if (payload == null) return;
    if (typeof payload['activityType'] !== 'string') {
      badRequest('Activity records require payload.activityType.');
    }
    if (typeof payload['value'] !== 'number') {
      badRequest('Activity records require payload.value as a number.');
    }
  }

  private async getItemFromTx(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ) {
    const record = await tx.userDailyRecord.findFirst({
      where: { id, userId, deletedAt: null },
      include: dailyRecordWithAttachments,
    });

    if (record == null) {
      this.ownershipService.throwRecordNotFound();
    }

    return this.mapperService.toItem(record, { includeMealPayload: true });
  }

  private prepareMealPayloadForWrite(
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

  private withMealHotFields(
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

  private async enqueueMealAnalysisIfNeeded(
    userId: string,
    item: {
      id: string;
      kind: DailyRecordKind;
      attachments: Array<{ objectKey: string }>;
      payload?: Record<string, unknown> | null;
    },
    sourceRevisionOverride?: number,
  ) {
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
}
