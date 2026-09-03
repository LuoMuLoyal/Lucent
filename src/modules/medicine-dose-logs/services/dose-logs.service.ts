import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  formatDateOnly,
  nonDeleted,
  normalizeNullableText,
  now,
  parseDateOnly,
} from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';

import { DoseLogStatus, Prisma } from '#generated/prisma/client.js';
import { MedicineDoseLogRepositoryPort } from '../repositories/dose-log.repository.js';
import {
  DOSE_LOG_CHANGED,
  type DoseLogChangedPayload,
} from '../../../common/events/domain-events.js';
import type { CreateDoseLogDto } from '../dto/create-dose-log.dto.js';

import type { MarkDoseLogDto } from '../dto/mark-dose-log.dto.js';
import { HealthEventsOwnershipService } from '../../health-events/index.js';

import type { UpdateDoseLogDto } from '../dto/update-dose-log.dto.js';
import type { DoseLogResponseDto } from '../dto/dose-log-response.dto.js';

type OwnedReminderRecord = {
  userId: string;
  currentMedicineId: string | null;
  scheduledHour: number;
  scheduledMinute: number;
};

@Injectable()
export class MedicineDoseLogsService {
  private readonly logger = new Logger(MedicineDoseLogsService.name);

  constructor(
    private readonly repository: MedicineDoseLogRepositoryPort,
    private readonly eventEmitter: EventEmitter2,
    private readonly healthEventsOwnership: HealthEventsOwnershipService,
  ) {}

  async list(
    userId: string,
    date: string,
    page: number = 1,
    pageSize: number = 50,
  ) {
    const where: Prisma.UserMedicineDoseLogWhereInput = {
      userId,
      scheduledFor: parseDateOnly(date),
      ...nonDeleted,
    };
    const { items, total } = await this.repository.findManyWithCount(
      where,
      [{ scheduledTime: 'asc' }, { createdAt: 'desc' }],
      { page, pageSize },
    );
    return {
      items: items.map((record) => this.toItem(record)),
      total,
    };
  }

  create(
    userId: string,
    dto: CreateDoseLogDto,
  ): ResultAsync<DoseLogResponseDto, DomainFailure> {
    const scheduledFor = parseDateOnly(dto.scheduledFor);
    return this.ensureActiveHealthEvent(userId, dto.healthEventId)
      .andThen(() =>
        this.ensureReminderOwned(userId, dto.reminderId, dto.currentMedicineId),
      )
      .andThen((reminder) =>
        this.resolveCurrentMedicineId(
          userId,
          dto.currentMedicineId,
          reminder,
        ).map((currentMedicineId) => ({ reminder, currentMedicineId })),
      )
      .andThen(({ reminder, currentMedicineId }) => {
        const scheduledTime = this.resolveScheduledTime(
          dto.scheduledTime,
          reminder,
        );
        return this.repository
          .create(
            this.buildCreateData(userId, {
              currentMedicineId,
              reminderId: dto.reminderId ?? null,
              status: dto.status,
              scheduledFor,
              scheduledTime,
              doseText: dto.doseText,
              note: dto.note,
              healthEventId: dto.healthEventId,
            }),
          )
          .andThen((record) =>
            this.afterWrite(userId, scheduledFor, record.id, () =>
              this.toItem(record),
            ),
          );
      });
  }

  mark(
    userId: string,
    dto: MarkDoseLogDto,
  ): ResultAsync<DoseLogResponseDto, DomainFailure> {
    const scheduledFor = parseDateOnly(dto.scheduledFor);
    return this.ensureActiveHealthEvent(userId, dto.healthEventId)
      .andThen(() =>
        this.ensureReminderOwned(userId, dto.reminderId, dto.currentMedicineId),
      )
      .andThen((reminder) =>
        this.resolveCurrentMedicineId(
          userId,
          dto.currentMedicineId,
          reminder,
        ).map((currentMedicineId) => ({ reminder, currentMedicineId })),
      )
      .andThen(({ reminder, currentMedicineId }) => {
        const scheduledTime = this.resolveScheduledTime(
          dto.scheduledTime,
          reminder,
        );
        const reminderId = dto.reminderId ?? null;

        const where = this.buildMarkLookupWhere({
          userId,
          currentMedicineId,
          reminderId,
          scheduledFor,
          scheduledTime,
        });
        if (where == null && currentMedicineId == null) {
          return errAsync(this.validationFailed());
        }

        const existingLookup =
          where == null
            ? okAsync(null)
            : fromPromise(
                this.repository.findFirst(where, {
                  orderBy: [{ updatedAt: 'desc' }],
                }),
                (error) => {
                  throw error;
                },
              );

        return existingLookup.andThen((existing) => {
          const existingId = (existing as { id: string } | null)?.id ?? null;
          if (existingId != null) {
            return this.repository
              .update(
                { id: existingId },
                this.buildMarkUpdateData({
                  currentMedicineId,
                  reminderId,
                  status: dto.status,
                  scheduledTime,
                  doseText: dto.doseText,
                  note: dto.note,
                  healthEventId: dto.healthEventId,
                }),
              )
              .andThen((record) =>
                this.afterWrite(userId, scheduledFor, record.id, () =>
                  this.toItem(record),
                ),
              );
          }

          return this.repository
            .create(
              this.buildCreateData(userId, {
                currentMedicineId,
                reminderId,
                status: dto.status,
                scheduledFor,
                scheduledTime,
                doseText: dto.doseText,
                note: dto.note,
                healthEventId: dto.healthEventId,
              }),
            )
            .andThen((record) =>
              this.afterWrite(userId, scheduledFor, record.id, () =>
                this.toItem(record),
              ),
            );
        });
      });
  }

  update(
    userId: string,
    id: string,
    dto: UpdateDoseLogDto,
  ): ResultAsync<DoseLogResponseDto, DomainFailure> {
    return this.ensureOwned(userId, id)
      .andThen(() => this.repository.update({ id }, this.buildUpdateData(dto)))
      .andThen((record) =>
        this.afterWriteById(userId, id, () => this.toItem(record)),
      );
  }

  delete(userId: string, id: string): ResultAsync<void, DomainFailure> {
    return this.ensureOwned(userId, id)
      .andThen(() =>
        fromPromise(this.invalidateSuggestionCacheById(userId, id), (error) => {
          throw error;
        }),
      )
      .andThen(() =>
        this.repository
          .update({ id }, { deletedAt: now() })
          .map(() => undefined),
      );
  }

  private async invalidateSuggestionCache(
    userId: string,
    scheduledFor: Date,
    doseLogId?: string,
  ): Promise<void> {
    try {
      await this.eventEmitter.emitAsync(DOSE_LOG_CHANGED, {
        userId,
        date: formatDateOnly(scheduledFor),
        ...(doseLogId != null ? { doseLogId } : {}),
      } satisfies DoseLogChangedPayload);
    } catch (error) {
      // best-effort
      this.logger.warn('Failed to emit dose-log.changed event', {
        userId,
        error,
      });
    }
  }

  private async invalidateSuggestionCacheById(
    userId: string,
    logId: string,
  ): Promise<void> {
    const log = await this.repository.findFirst(
      { id: logId, userId },
      {
        select: { scheduledFor: true },
      },
    );
    if (log != null && typeof log === 'object' && 'scheduledFor' in log) {
      await this.invalidateSuggestionCache(
        userId,
        (log as { scheduledFor: Date }).scheduledFor,
        logId,
      );
    }
  }

  /** Best-effort suggestion-cache invalidation, then maps the written record. */
  private afterWrite<T>(
    userId: string,
    scheduledFor: Date,
    doseLogId: string,
    build: () => T,
  ): ResultAsync<T, DomainFailure> {
    return fromPromise(
      this.invalidateSuggestionCache(userId, scheduledFor, doseLogId),
      (error) => {
        throw error;
      },
    ).map(build);
  }

  /** Best-effort suggestion-cache invalidation by id, then maps the record. */
  private afterWriteById<T>(
    userId: string,
    logId: string,
    build: () => T,
  ): ResultAsync<T, DomainFailure> {
    return fromPromise(
      this.invalidateSuggestionCacheById(userId, logId),
      (error) => {
        throw error;
      },
    ).map(build);
  }

  private buildUpdateData(
    dto: UpdateDoseLogDto,
  ): Prisma.UserMedicineDoseLogUpdateInput {
    const data: Prisma.UserMedicineDoseLogUpdateInput = {};
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.takenAt = dto.status === DoseLogStatus.taken ? now() : null;
    }
    if (dto.doseText !== undefined) {
      data.doseText = normalizeNullableText(dto.doseText);
    }
    if (dto.note !== undefined) {
      data.note = normalizeNullableText(dto.note);
    }
    return data;
  }

  private buildCreateData(
    userId: string,
    input: {
      currentMedicineId: string | null;
      reminderId: string | null;
      status: DoseLogStatus;
      scheduledFor: Date;
      scheduledTime: string | null;
      doseText: string | null | undefined;
      note: string | null | undefined;
      healthEventId: string | null | undefined;
    },
  ): Prisma.UserMedicineDoseLogUncheckedCreateInput {
    return {
      userId,
      currentMedicineId: input.currentMedicineId,
      reminderId: input.reminderId,
      status: input.status,
      scheduledFor: input.scheduledFor,
      scheduledTime: input.scheduledTime,
      takenAt: input.status === DoseLogStatus.taken ? now() : null,
      doseText: normalizeNullableText(input.doseText),
      note: normalizeNullableText(input.note),
      healthEventId: input.healthEventId ?? null,
    };
  }

  private buildMarkLookupWhere(input: {
    userId: string;
    currentMedicineId: string | null;
    reminderId: string | null;
    scheduledFor: Date;
    scheduledTime: string | null;
  }): Prisma.UserMedicineDoseLogWhereInput | null {
    if (input.reminderId != null) {
      return {
        userId: input.userId,
        reminderId: input.reminderId,
        scheduledFor: input.scheduledFor,
        scheduledTime: input.scheduledTime,
        deletedAt: null,
      };
    }

    // Temporary logs have no stable slot identity other than their own id;
    // never merge them by medicine/date/time.
    return null;
  }

  private buildMarkUpdateData(input: {
    currentMedicineId: string | null;
    reminderId: string | null;
    status: DoseLogStatus;
    scheduledTime: string | null;
    doseText: string | null | undefined;
    note: string | null | undefined;
    healthEventId: string | null | undefined;
  }): Prisma.UserMedicineDoseLogUncheckedUpdateInput {
    const data: Prisma.UserMedicineDoseLogUncheckedUpdateInput = {
      currentMedicineId: input.currentMedicineId,
      reminderId: input.reminderId,
      status: input.status,
      scheduledTime: input.scheduledTime,
      takenAt: input.status === DoseLogStatus.taken ? now() : null,
      doseText: normalizeNullableText(input.doseText),
      note: normalizeNullableText(input.note),
    };
    if (input.healthEventId !== undefined) {
      data.healthEventId = input.healthEventId;
    }
    return data;
  }

  private toItem(r: Prisma.UserMedicineDoseLogGetPayload<object>) {
    return {
      id: r.id,
      healthEventId: r.healthEventId,
      currentMedicineId: r.currentMedicineId,
      reminderId: r.reminderId,
      status: r.status,
      scheduledFor: formatDateOnly(r.scheduledFor),
      scheduledTime: r.scheduledTime,
      doseText: r.doseText,
      note: r.note,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private ensureReminderOwned(
    userId: string,
    reminderId: string | undefined,
    currentMedicineId: string | undefined,
  ): ResultAsync<OwnedReminderRecord | null, DomainFailure> {
    if (!reminderId) {
      return okAsync(null);
    }

    return fromPromise(
      this.repository.findReminderById(userId, reminderId),
      (error) => {
        throw error;
      },
    ).andThen((reminder) => {
      if (!reminder) {
        return errAsync(this.reminderNotFoundFailure());
      }
      if (
        currentMedicineId != null &&
        reminder.currentMedicineId != null &&
        reminder.currentMedicineId !== currentMedicineId
      ) {
        return errAsync(this.validationFailed());
      }
      return okAsync(reminder);
    });
  }

  private resolveCurrentMedicineId(
    userId: string,
    currentMedicineId: string | undefined,
    reminder: OwnedReminderRecord | null,
  ): ResultAsync<string | null, DomainFailure> {
    const resolvedCurrentMedicineId =
      currentMedicineId ?? reminder?.currentMedicineId ?? null;

    if (!resolvedCurrentMedicineId) {
      return okAsync(null);
    }

    return fromPromise(
      this.repository.findCurrentMedicineById(
        userId,
        resolvedCurrentMedicineId,
      ),
      (error) => {
        throw error;
      },
    ).andThen((medicine) =>
      medicine == null
        ? errAsync(this.medicineNotFoundFailure())
        : okAsync(resolvedCurrentMedicineId),
    );
  }

  private resolveScheduledTime(
    scheduledTime: string | undefined,
    reminder: OwnedReminderRecord | null,
  ) {
    if (scheduledTime != null) {
      return scheduledTime;
    }
    if (reminder == null) {
      return null;
    }

    return `${String(reminder.scheduledHour).padStart(2, '0')}:${String(
      reminder.scheduledMinute,
    ).padStart(2, '0')}`;
  }

  private ensureActiveHealthEvent(
    userId: string,
    healthEventId: string | null | undefined,
  ): ResultAsync<void, DomainFailure> {
    if (healthEventId == null) {
      return okAsync(undefined);
    }
    // HealthEventsOwnershipService keeps the legacy Promise<T> contract and
    // folds the events module ResultAsync with unwrapResult (its DomainFailure
    // surfaces as DomainFailureException through the global filter). Unknown
    // failures rethrow. TODO(error): consume the events Result directly when
    // the health-events ownership shim is removed (Task 10).
    return fromPromise(
      this.healthEventsOwnership.ensureActiveOwnedByUser(userId, healthEventId),
      (error) => {
        throw error;
      },
    ).map(() => undefined);
  }

  private ensureOwned(
    userId: string,
    id: string,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.repository.findFirst(
        { id, userId, deletedAt: null },
        { select: { userId: true } },
      ),
      (error) => {
        throw error;
      },
    ).andThen((record) => {
      if (record == null) {
        return errAsync(this.doseLogNotFoundFailure());
      }
      return okAsync(undefined);
    });
  }

  private validationFailed(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }

  private reminderNotFoundFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }

  private medicineNotFoundFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }

  private doseLogNotFoundFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }
}
