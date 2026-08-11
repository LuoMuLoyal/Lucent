import { badRequest, notFound } from '../../../common';
import { formatDateOnly, now, parseDateOnly } from '../../../common';
import { nonDeleted } from '../../../common';
import { normalizeNullableText } from '../../../common';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { I18nService } from 'nestjs-i18n';

import { DoseLogStatus, Prisma } from '#generated/prisma/client';
import { MedicineDoseLogRepositoryPort } from '../repositories/dose-log.repository';
import {
  DOSE_LOG_CHANGED,
  type DoseLogChangedPayload,
} from '../../../common/events/domain-events.js';
import type { CreateDoseLogDto } from '../dto/create-dose-log.dto';

import type { MarkDoseLogDto } from '../dto/mark-dose-log.dto';
import { HealthEventsOwnershipService } from '../../health-events';

import type { UpdateDoseLogDto } from '../dto/update-dose-log.dto';

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
    private readonly i18n: I18nService,
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

  async create(userId: string, dto: CreateDoseLogDto) {
    const scheduledFor = parseDateOnly(dto.scheduledFor);
    await this.ensureActiveHealthEvent(userId, dto.healthEventId);
    const reminder = await this.ensureReminderOwned(
      userId,
      dto.reminderId,
      dto.currentMedicineId,
    );
    const currentMedicineId = await this.resolveCurrentMedicineId(
      userId,
      dto.currentMedicineId,
      reminder,
    );
    const scheduledTime = this.resolveScheduledTime(
      dto.scheduledTime,
      reminder,
    );

    const record = await this.repository.create(
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
    );
    await this.invalidateSuggestionCache(userId, scheduledFor, record.id);
    return this.toItem(record);
  }

  async mark(userId: string, dto: MarkDoseLogDto) {
    const scheduledFor = parseDateOnly(dto.scheduledFor);
    await this.ensureActiveHealthEvent(userId, dto.healthEventId);
    const reminder = await this.ensureReminderOwned(
      userId,
      dto.reminderId,
      dto.currentMedicineId,
    );
    const currentMedicineId = await this.resolveCurrentMedicineId(
      userId,
      dto.currentMedicineId,
      reminder,
    );
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
    if (where == null) {
      badRequest(this.i18n.t('medicine-dose-logs.missing_slot_identifier'));
    }

    const existing = (await this.repository.findFirst(where, {
      orderBy: [{ updatedAt: 'desc' }],
    })) as { id: string } | null;

    if (existing) {
      const record = await this.repository.update(
        { id: existing.id },
        this.buildMarkUpdateData({
          currentMedicineId,
          reminderId,
          status: dto.status,
          scheduledTime,
          doseText: dto.doseText,
          note: dto.note,
          healthEventId: dto.healthEventId,
        }),
      );
      await this.invalidateSuggestionCache(userId, scheduledFor, record.id);
      return this.toItem(record);
    }

    const record = await this.repository.create(
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
    );
    await this.invalidateSuggestionCache(userId, scheduledFor, record.id);
    return this.toItem(record);
  }

  async update(userId: string, id: string, dto: UpdateDoseLogDto) {
    await this.ensureOwned(userId, id);
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
    const record = await this.repository.update({ id }, data);
    await this.invalidateSuggestionCacheById(userId, id);
    return this.toItem(record);
  }

  async delete(userId: string, id: string) {
    await this.ensureOwned(userId, id);
    await this.invalidateSuggestionCacheById(userId, id);
    await this.repository.update({ id }, { deletedAt: now() });
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
        deletedAt: null,
      };
    }

    if (input.currentMedicineId != null && input.scheduledTime != null) {
      return {
        userId: input.userId,
        currentMedicineId: input.currentMedicineId,
        scheduledFor: input.scheduledFor,
        scheduledTime: input.scheduledTime,
        deletedAt: null,
      };
    }

    // No safe lookup criteria available — caller should reject.
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

  private async ensureReminderOwned(
    userId: string,
    reminderId: string | undefined,
    currentMedicineId: string | undefined,
  ): Promise<OwnedReminderRecord | null> {
    if (!reminderId) {
      return null;
    }

    const reminder = await this.repository.findReminderById(userId, reminderId);
    if (!reminder) {
      notFound(this.i18n.t('medicine-reminders.reminder_not_found'));
    }
    if (
      currentMedicineId != null &&
      reminder.currentMedicineId != null &&
      reminder.currentMedicineId !== currentMedicineId
    ) {
      badRequest(this.i18n.t('medicine-dose-logs.invalid_slot_identity'));
    }

    return reminder;
  }

  private async resolveCurrentMedicineId(
    userId: string,
    currentMedicineId: string | undefined,
    reminder: OwnedReminderRecord | null,
  ) {
    const resolvedCurrentMedicineId =
      currentMedicineId ?? reminder?.currentMedicineId ?? null;

    if (resolvedCurrentMedicineId) {
      const medicine = await this.repository.findCurrentMedicineById(
        userId,
        resolvedCurrentMedicineId,
      );
      if (!medicine) {
        notFound(this.i18n.t('medicine-dose-logs.medicine_not_found'));
      }
    }

    return resolvedCurrentMedicineId;
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

  private async ensureActiveHealthEvent(
    userId: string,
    healthEventId: string | null | undefined,
  ): Promise<void> {
    if (healthEventId != null) {
      await this.healthEventsOwnership.ensureActiveOwnedByUser(
        userId,
        healthEventId,
      );
    }
  }

  private async ensureOwned(userId: string, id: string) {
    const record = (await this.repository.findFirst(
      { id, userId, deletedAt: null },
      { select: { userId: true } },
    )) as { userId: string } | null;
    if (!record) {
      notFound(this.i18n.t('medicine-dose-logs.not_found'));
    }
  }
}
