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
import { PrismaService } from '../../../prisma/prisma.service';
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
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async list(userId: string, date: string) {
    const where: Prisma.UserMedicineDoseLogWhereInput = {
      userId,
      scheduledFor: parseDateOnly(date),
      ...nonDeleted,
    };
    const items = await this.prisma.userMedicineDoseLog.findMany({
      where,
      orderBy: [{ scheduledTime: 'asc' }, { createdAt: 'desc' }],
    });
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

    const record = await this.prisma.userMedicineDoseLog.create({
      data: this.buildCreateData(userId, {
        currentMedicineId,
        reminderId: dto.reminderId ?? null,
        status: dto.status,
        scheduledFor,
        scheduledTime,
        doseText: dto.doseText,
        note: dto.note,
      }),
    });
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

    const existing = await this.prisma.userMedicineDoseLog.findFirst({
      where: this.buildMarkLookupWhere({
        userId,
        currentMedicineId,
        reminderId,
        scheduledFor,
        scheduledTime,
      }),
      orderBy: [{ updatedAt: 'desc' }],
    });

    if (existing) {
      const record = await this.prisma.userMedicineDoseLog.update({
        where: { id: existing.id },
        data: this.buildMarkUpdateData({
          currentMedicineId,
          reminderId,
          status: dto.status,
          scheduledTime,
          doseText: dto.doseText,
          note: dto.note,
        }),
      });
      return this.toItem(record);
    }

    const record = await this.prisma.userMedicineDoseLog.create({
      data: this.buildCreateData(userId, {
        currentMedicineId,
        reminderId,
        status: dto.status,
        scheduledFor,
        scheduledTime,
        doseText: dto.doseText,
        note: dto.note,
      }),
    });
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
    const record = await this.prisma.userMedicineDoseLog.update({
      where: { id },
      data,
    });
    return this.toItem(record);
  }

  async delete(userId: string, id: string) {
    await this.ensureOwned(userId, id);
    await this.prisma.userMedicineDoseLog.update({
      where: { id },
      data: { deletedAt: now() },
    });
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

    return {
      userId: input.userId,
      currentMedicineId: input.currentMedicineId,
      scheduledFor: input.scheduledFor,
      deletedAt: null,
    };
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

    const reminder = await this.prisma.userMedicineReminder.findFirst({
      where: { id: reminderId, deletedAt: null },
      select: {
        userId: true,
        currentMedicineId: true,
        scheduledHour: true,
        scheduledMinute: true,
      },
    });
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
      const medicine = await this.prisma.userCurrentMedicine.findUnique({
        where: { id: resolvedCurrentMedicineId },
        select: { userId: true },
      });
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
    const record = await this.prisma.userMedicineDoseLog.findFirst({
      where: { id, deletedAt: null },
      select: { userId: true },
    });
    if (!record || record.userId !== userId) {
      notFound(this.i18n.t('medicine-dose-logs.not_found'));
    }
  }
}
