import { badRequest, notFound } from '../../../common/helpers/api-errors';
import {
  formatDateOnly,
  now,
  parseDateOnly,
} from '../../../common/helpers/date-time.utils';
import { nonDeleted } from '../../../common/helpers/prisma.helpers';
import { normalizeNullableText } from '../../../common/helpers/string.utils';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { DoseLogStatus, Prisma } from '#generated/prisma/client';
import { MedicineDoseLogRepositoryPort } from '../repositories';
import { SuggestionCacheService } from '../../today-suggestion/services/cache/suggestion-cache.service';
import type {
  CreateDoseLogDto,
  MarkDoseLogDto,
  UpdateDoseLogDto,
} from '../dto';

type OwnedReminderRecord = {
  userId: string;
  currentMedicineId: string | null;
  scheduledHour: number;
  scheduledMinute: number;
};

@Injectable()
export class MedicineDoseLogsService {
  constructor(
    private readonly repository: MedicineDoseLogRepositoryPort,
    private readonly i18n: I18nService,
    private readonly suggestionCache: SuggestionCacheService,
  ) {}

  async list(userId: string, date: string) {
    const where: Prisma.UserMedicineDoseLogWhereInput = {
      userId,
      scheduledFor: parseDateOnly(date),
      ...nonDeleted,
    };
    const items = await this.repository.findMany(where, [
      { scheduledTime: 'asc' },
      { createdAt: 'desc' },
    ]);
    return { items: items.map((record) => this.toItem(record)) };
  }

  async create(userId: string, dto: CreateDoseLogDto) {
    const scheduledFor = parseDateOnly(dto.scheduledFor);
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
      }),
    );
    await this.invalidateSuggestionCache(userId, scheduledFor);
    return this.toItem(record);
  }

  async mark(userId: string, dto: MarkDoseLogDto) {
    const scheduledFor = parseDateOnly(dto.scheduledFor);
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

    if (!reminderId && !currentMedicineId) {
      badRequest(this.i18n.t('medicine-dose-logs.missing_slot_identifier'));
    }

    const existing = (await this.repository.findFirst(
      this.buildMarkLookupWhere({
        userId,
        currentMedicineId,
        reminderId,
        scheduledFor,
        scheduledTime,
      }),
      { orderBy: [{ updatedAt: 'desc' }] },
    )) as { id: string } | null;

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
        }),
      );
      await this.invalidateSuggestionCache(userId, scheduledFor);
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
      }),
    );
    await this.invalidateSuggestionCache(userId, scheduledFor);
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
  ): Promise<void> {
    try {
      await this.suggestionCache.invalidateSignals(
        userId,
        formatDateOnly(scheduledFor),
      );
    } catch {
      // best-effort
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
    };
  }

  private buildMarkLookupWhere(input: {
    userId: string;
    currentMedicineId: string | null;
    reminderId: string | null;
    scheduledFor: Date;
    scheduledTime: string | null;
  }): Prisma.UserMedicineDoseLogWhereInput {
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

    // No safe lookup criteria available — refuse rather than risk a broad match.
    badRequest(this.i18n.t('medicine-dose-logs.missing_slot_identifier'));
  }

  private buildMarkUpdateData(input: {
    currentMedicineId: string | null;
    reminderId: string | null;
    status: DoseLogStatus;
    scheduledTime: string | null;
    doseText: string | null | undefined;
    note: string | null | undefined;
  }): Prisma.UserMedicineDoseLogUncheckedUpdateInput {
    return {
      currentMedicineId: input.currentMedicineId,
      reminderId: input.reminderId,
      status: input.status,
      scheduledTime: input.scheduledTime,
      takenAt: input.status === DoseLogStatus.taken ? now() : null,
      doseText: normalizeNullableText(input.doseText),
      note: normalizeNullableText(input.note),
    };
  }

  private toItem(r: Prisma.UserMedicineDoseLogGetPayload<object>) {
    return {
      id: r.id,
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

    const reminder = await this.repository.findReminderById(reminderId);
    if (!reminder || reminder.userId !== userId) {
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
        resolvedCurrentMedicineId,
      );
      if (!medicine || medicine.userId !== userId) {
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

  private async ensureOwned(userId: string, id: string) {
    const record = (await this.repository.findFirst(
      { id, deletedAt: null },
      { select: { userId: true } },
    )) as { userId: string } | null;
    if (!record || record.userId !== userId) {
      notFound(this.i18n.t('medicine-dose-logs.not_found'));
    }
  }
}
