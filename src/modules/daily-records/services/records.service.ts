import { fromPrismaResult, normalizeNullableText } from '../../../common';
import { parseDateOnly, now, formatDateOnly } from '../../../common';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import { DomainFailureException } from '../../../common/result/unwrap-result';
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

  create(
    userId: string,
    dto: CreateDailyRecordDto,
  ): ResultAsync<
    ReturnType<DailyRecordsMapperService['toItem']>,
    DomainFailure
  > {
    const payloadFailure = this.validateCreatePayload(dto.kind, dto.payload);
    if (payloadFailure != null) {
      return errAsync(payloadFailure);
    }

    const healthEventId = dto.healthEventId ?? null;
    const healthEventStep =
      healthEventId === null
        ? okAsync(undefined)
        : this.requireActiveHealthEvent(userId, healthEventId);

    return healthEventStep.andThen(() =>
      this.doCreate(userId, dto, healthEventId),
    );
  }

  private doCreate(
    userId: string,
    dto: CreateDailyRecordDto,
    healthEventId: string | null,
  ): ResultAsync<
    ReturnType<DailyRecordsMapperService['toItem']>,
    DomainFailure
  > {
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
      return fromPromise(
        this.repository.transaction(async (tx) => {
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
              throw new InternalServerErrorException(
                'Expected one meal attachment after length check.',
              );
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
        }),
        (error) => {
          throw error;
        },
      ).map(async ({ item, queuedRevision }) => {
        await this.enqueueMealAnalysisIfNeeded(
          userId,
          item,
          queuedRevision ?? undefined,
        );
        await this.invalidateSuggestionCache(
          userId,
          dto.occurredAt,
          dto.kind,
          item.id,
        );
        return item;
      });
    }

    return this.repository
      .create({
        ...baseData,
        ...payloadField,
      })
      .map(async (record) => {
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
      });
  }

  get(
    userId: string,
    id: string,
  ): ResultAsync<
    ReturnType<DailyRecordsMapperService['toItem']>,
    DomainFailure
  > {
    return this.ownershipService
      .ensureOwnedByUser(userId, id)
      .andThen(() =>
        fromPromise(
          this.repository.findByIdWithAttachments(userId, id),
          (error) => {
            throw error;
          },
        ),
      )
      .andThen((record) => {
        // Only reachable when the record disappears between the ownership
        // check and the read (race); treat like a missing resource.
        if (record == null) {
          return errAsync(this.notFound());
        }
        return okAsync(
          this.mapperService.toItem(record, { includeMealPayload: true }),
        );
      });
  }

  update(
    userId: string,
    id: string,
    dto: UpdateDailyRecordDto,
  ): ResultAsync<
    ReturnType<DailyRecordsMapperService['toItem']>,
    DomainFailure
  > {
    return this.ownershipService
      .ensureOwnedByUser(userId, id)
      .andThen((existing) => {
        const healthEventStep =
          dto.healthEventId !== undefined && dto.healthEventId !== null
            ? this.requireActiveHealthEvent(userId, dto.healthEventId)
            : okAsync(undefined);
        return healthEventStep.andThen(() => {
          const sleepFailure = this.ensureValidSleepFinalState(dto, existing);
          if (sleepFailure != null) {
            return errAsync(sleepFailure);
          }

          const isMealTarget =
            (dto.kind ?? existing.kind) === DailyRecordKind.meal;
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
              nextPayload = markMealAnalysisQueued(nextPayload, {
                imageObjectKey,
              });
            }
          }

          if (updateAttachments !== undefined) {
            return this.updateWithAttachments(
              userId,
              id,
              existing,
              dto,
              updateAttachments,
              nextPayload,
              confirmRequested,
            );
          }

          return this.repository
            .update(
              id,
              this.withMealHotFields(
                this.mapperService.toRecordUpdateData(dto, existing),
                nextPayload,
              ),
            )
            .map(async (record) => {
              const item = this.mapperService.toItem(record, {
                includeMealPayload: true,
              });
              if (confirmRequested) {
                await this.mealDishTemplateLearningService.learnFromConfirmedAnalysis(
                  parseMealRecordPayload(item.payload).mealAnalysis,
                );
                await this.invalidateSuggestionCacheForUpdate(
                  userId,
                  id,
                  existing,
                  dto,
                );
                return item;
              }
              await this.enqueueMealAnalysisIfNeeded(userId, item);
              await this.invalidateSuggestionCacheForUpdate(
                userId,
                id,
                existing,
                dto,
              );
              return item;
            });
        });
      });
  }

  private updateWithAttachments(
    userId: string,
    id: string,
    existing: OwnedRecordSnapshot,
    dto: UpdateDailyRecordDto,
    updateAttachments: NonNullable<UpdateDailyRecordDto['attachments']>,
    nextPayload: Record<string, unknown> | null,
    confirmRequested: boolean,
  ): ResultAsync<
    ReturnType<DailyRecordsMapperService['toItem']>,
    DomainFailure
  > {
    return fromPromise(
      this.repository.transaction(async (tx) => {
        // The ownership check ran before this transaction; a P2025 here means
        // the record was deleted in the race window. Fold it into the same
        // RESOURCE_NOT_FOUND the plain update path returns instead of letting
        // it surface as a 500. Unknown errors abort the transaction as-is.
        await fromPrismaResult(
          tx.userDailyRecord.update({
            where: { id },
            data: this.withMealHotFields(
              this.mapperService.toRecordUpdateData(dto, existing),
              nextPayload,
            ),
          }),
        ).match(
          () => undefined,
          (failure) => {
            throw new DomainFailureException(failure);
          },
        );
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
      }),
      (error) => {
        if (error instanceof DomainFailureException) {
          return error.failure;
        }
        throw error;
      },
    )
      .andThen((item) => {
        if (confirmRequested) {
          return fromPromise(
            this.mealDishTemplateLearningService.learnFromConfirmedAnalysis(
              parseMealRecordPayload(item.payload).mealAnalysis,
            ),
            (error) => {
              throw error;
            },
          ).map(() => item);
        }
        return okAsync(item);
      })
      .map(async (item) => {
        await this.enqueueMealAnalysisIfNeeded(
          userId,
          item,
          nextPayload == null ? undefined : getMealSourceRevision(nextPayload),
        );
        await this.invalidateSuggestionCacheForUpdate(
          userId,
          id,
          existing,
          dto,
        );
        return item;
      });
  }

  delete(userId: string, id: string): ResultAsync<void, DomainFailure> {
    return this.ownershipService
      .ensureOwnedByUser(userId, id)
      .andThen((existing) =>
        this.repository.softDelete(id, now()).map(() => existing),
      )
      .map(async (existing) => {
        if (existing.occurredAt != null) {
          await this.invalidateSuggestionCache(
            userId,
            existing.occurredAt,
            existing.kind,
            id,
          );
        }
      });
  }

  async summary(userId: string, date: string) {
    const records = await this.repository.findManyByDateWithAttachments(
      userId,
      parseDateOnly(date),
    );

    return this.mapperService.toSummaries(records);
  }

  /**
   * Folds the health-events ownership façade's Promise contract back into a
   * Result. The façade still throws `DomainFailureException` for out-of-scope
   * consumers (reports, medicine-dose-logs); here the failure is recovered
   * as an Err. TODO(error): drop this extraction when the façade becomes
   * ResultAsync (Tasks 8.2/10).
   */
  private requireActiveHealthEvent(
    userId: string,
    eventId: string,
  ): ResultAsync<unknown, DomainFailure> {
    return fromPromise(
      this.healthEventsOwnershipService.ensureActiveOwnedByUser(
        userId,
        eventId,
      ),
      (error) => {
        if (error instanceof DomainFailureException) {
          return error.failure;
        }
        throw error;
      },
    );
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

  private validateCreatePayload(
    kind: string,
    payload: Record<string, unknown> | undefined,
  ): DomainFailure | null {
    return (
      this.validateSleepPayload(kind, payload) ??
      this.validateVitalPayload(kind, payload) ??
      this.validateActivityPayload(kind, payload)
    );
  }

  private validateSleepPayload(
    kind: string,
    payload: Record<string, unknown> | null | undefined,
  ): DomainFailure | null {
    if (kind !== DailyRecordKind.sleep) {
      return null;
    }
    if (payload == null) {
      return this.validationFailed();
    }

    // Quick-entry sleep flow creates temporary start/wake event records first,
    // then merges them into a final sleep record with durationMinutes. Allow
    // those temporary event records to skip the duration validation.
    const sleepEvent = payload['sleepEvent'];
    if (sleepEvent === 'start' || sleepEvent === 'wake') {
      return null;
    }

    if (
      payload['sleepType'] !== undefined &&
      payload['sleepType'] !== 'nightSleep' &&
      payload['sleepType'] !== 'nap'
    ) {
      return this.validationFailed();
    }
    if (
      payload['quality'] !== undefined &&
      typeof payload['quality'] !== 'string'
    ) {
      return this.validationFailed();
    }

    const startedAt = payload['startedAt'] ?? payload['startAt'];
    const endedAt = payload['endedAt'] ?? payload['endAt'];
    if ((startedAt == null) !== (endedAt == null)) {
      return this.validationFailed();
    }
    if (startedAt != null && endedAt != null) {
      if (typeof startedAt !== 'string' || typeof endedAt !== 'string') {
        return this.validationFailed();
      }
      const started = new Date(startedAt);
      const ended = new Date(endedAt);
      if (
        Number.isNaN(started.getTime()) ||
        Number.isNaN(ended.getTime()) ||
        ended.getTime() <= started.getTime()
      ) {
        return this.validationFailed();
      }
    }

    if (
      typeof payload['durationMinutes'] !== 'number' ||
      !Number.isFinite(payload['durationMinutes'])
    ) {
      return this.validationFailed();
    }
    if (payload['durationMinutes'] <= 0) {
      return this.validationFailed();
    }
    return null;
  }

  private validateVitalPayload(
    kind: string,
    payload: Record<string, unknown> | undefined,
  ): DomainFailure | null {
    if (kind !== DailyRecordKind.vital) return null;
    if (payload == null) return null;
    if (typeof payload['vitalType'] !== 'string') {
      return this.validationFailed();
    }
    if (typeof payload['value'] !== 'number') {
      return this.validationFailed();
    }
    return null;
  }

  private validateActivityPayload(
    kind: string,
    payload: Record<string, unknown> | undefined,
  ): DomainFailure | null {
    if (kind !== DailyRecordKind.activity) return null;
    if (payload == null) return null;
    if (typeof payload['activityType'] !== 'string') {
      return this.validationFailed();
    }
    if (typeof payload['value'] !== 'number') {
      return this.validationFailed();
    }
    return null;
  }

  private ensureValidSleepFinalState(
    dto: UpdateDailyRecordDto,
    existing: { kind: DailyRecordKind; payload: unknown },
  ): DomainFailure | null {
    const finalKind = dto.kind !== undefined ? dto.kind : existing.kind;
    if (finalKind !== DailyRecordKind.sleep) {
      return null;
    }

    const rawPayload =
      dto.payload !== undefined ? dto.payload : existing.payload;
    return this.validateSleepPayload(
      finalKind,
      rawPayload as Record<string, unknown> | null,
    );
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

  private notFound(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }

  private validationFailed(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }
}
