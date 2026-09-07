import {
  fromPrismaResult,
  normalizeNullableText,
} from '../../../common/index.js';
import { parseDateOnly, now, formatDateOnly } from '../../../common/index.js';
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
} from '../../../common/result/index.js';
import { DomainFailureException } from '../../../common/result/unwrap-result.js';
import { DailyRecordKind, Prisma } from '#generated/prisma/client.js';
import { toInputJsonValue } from '../../../common/index.js';
import type { CreateDailyRecordDto } from '../dto/create-record.dto.js';
import type { UpdateDailyRecordDto } from '../dto/update-record.dto.js';
import { DailyRecordsOwnershipService } from './ownership.service.js';
import { DailyRecordsMapperService } from './mapper.service.js';
import {
  dailyRecordWithAttachments,
  type OwnedRecordSnapshot,
} from '../types/record.types.js';
import {
  buildConfirmedMealPayload,
  getMealSourceRevision,
  hasMealDishInputChanges,
  isMealAnalysisConfirmRequest,
  markMealAnalysisQueued,
} from '../types/meal-analysis.types.js';
import { MealDishTemplateLearningService } from './meal-dish/template-learning.service.js';
import { DailyRecordRepositoryPort } from '../repositories/daily-record.repository.js';
import { HealthEventsOwnershipService } from '../../health-events/index.js';
import { DailyRecordsValidatorService } from './records-validator.service.js';
import { MealPayloadWriterService } from './meal-payload-writer.service.js';
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
    private readonly mealPayloadWriterService: MealPayloadWriterService,
    private readonly validatorService: DailyRecordsValidatorService,
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
    const payloadFailure = this.validatorService.validateCreatePayload(
      dto.kind,
      dto.payload,
    );
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
        ? this.mealPayloadWriterService.prepareMealPayloadForWrite(
            dto.payload,
            createAttachments,
          )
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
        ? this.mealPayloadWriterService.toCreateFields(initialMealPayload)
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
              data: this.mealPayloadWriterService.withMealHotFields(
                {},
                queuedPayload,
              ),
            });
          }
          const txItem = await this.getItemFromTx(tx, userId, record.id);
          return { item: txItem, queuedRevision };
        }),
        (error) => {
          throw error;
        },
      ).map(async ({ item, queuedRevision }) => {
        await this.mealPayloadWriterService.enqueueAnalysisIfNeeded(
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
        await this.mealPayloadWriterService.enqueueAnalysisIfNeeded(
          userId,
          item,
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
          const sleepFailure = this.validatorService.ensureValidSleepFinalState(
            dto,
            existing,
          );
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
              ? this.mealPayloadWriterService.prepareMealPayloadForWrite(
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
            nextPayload =
              this.mealPayloadWriterService.requeueOnDishChange(nextPayload);
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
              this.mealPayloadWriterService.withMealHotFields(
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
                  this.mealPayloadWriterService.parseAnalysis(item),
                );
                await this.invalidateSuggestionCacheForUpdate(
                  userId,
                  id,
                  existing,
                  dto,
                );
                return item;
              }
              await this.mealPayloadWriterService.enqueueAnalysisIfNeeded(
                userId,
                item,
              );
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
            data: this.mealPayloadWriterService.withMealHotFields(
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
              this.mealPayloadWriterService.parseAnalysis(item),
            ),
            (error) => {
              throw error;
            },
          ).map(() => item);
        }
        return okAsync(item);
      })
      .map(async (item) => {
        await this.mealPayloadWriterService.enqueueAnalysisIfNeeded(
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

  private notFound(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }
}
