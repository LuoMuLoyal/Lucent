import { badRequest } from '../../../common';
import { normalizeNullableText } from '../../../common';
import { formatDateOnly } from '../../../common';
import { parseDateOnly } from '../../../common';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { Prisma } from '#generated/prisma/client';
import type { CreateMedicineReminderDto } from '../dto/create.dto';

import type { UpdateMedicineReminderDto } from '../dto/update.dto';
import type {
  MedicineReminderRecord,
  OwnedMedicineReminderRecord,
  ReminderDeliveryRecord,
} from '../types/reminder.types';

@Injectable()
export class MedicineRemindersMapperService {
  constructor(private readonly i18n: I18nService) {}
  toCreateData(userId: string, dto: CreateMedicineReminderDto) {
    const startDate = this.parseOptionalDate(dto.startDate);
    const endDate = this.parseOptionalDate(dto.endDate);
    this.assertValidDateWindow(startDate, endDate);

    return {
      userId,
      currentMedicineId: dto.currentMedicineId ?? null,
      label: normalizeNullableText(dto.label),
      scheduledHour: dto.scheduledHour,
      scheduledMinute: dto.scheduledMinute,
      daysOfWeek: this.normalizeDaysOfWeek(dto.daysOfWeek),
      startDate,
      endDate,
      isActive: dto.isActive ?? true,
      note: normalizeNullableText(dto.note),
    } satisfies Prisma.UserMedicineReminderUncheckedCreateInput;
  }

  toUpdateData(
    dto: UpdateMedicineReminderDto,
    existing: OwnedMedicineReminderRecord,
  ) {
    const data: Prisma.UserMedicineReminderUpdateInput = {};

    if (dto.currentMedicineId !== undefined) {
      data.currentMedicine = dto.currentMedicineId
        ? { connect: { id: dto.currentMedicineId } }
        : { disconnect: true };
    }
    if (dto.label !== undefined) {
      data.label = normalizeNullableText(dto.label);
    }
    if (dto.scheduledHour !== undefined) {
      data.scheduledHour = dto.scheduledHour;
    }
    if (dto.scheduledMinute !== undefined) {
      data.scheduledMinute = dto.scheduledMinute;
    }
    if (dto.daysOfWeek !== undefined) {
      data.daysOfWeek = this.normalizeDaysOfWeek(dto.daysOfWeek);
    }

    const startDate =
      dto.startDate === undefined
        ? existing.startDate
        : this.parseOptionalDate(dto.startDate);
    const endDate =
      dto.endDate === undefined
        ? existing.endDate
        : this.parseOptionalDate(dto.endDate);
    this.assertValidDateWindow(startDate, endDate);

    if (dto.startDate !== undefined) {
      data.startDate = startDate;
    }
    if (dto.endDate !== undefined) {
      data.endDate = endDate;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }
    if (dto.note !== undefined) {
      data.note = normalizeNullableText(dto.note);
    }

    return data;
  }

  toDeliveryWhere(userId: string, date?: string) {
    const where: Prisma.UserReminderDeliveryWhereInput = { userId };

    if (date != null && date.trim().length > 0) {
      const start = this.parseRequiredDate(date);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      where.scheduledFor = { gte: start, lt: end };
    }

    return where;
  }

  capDeliveryLimit(limit: number): number {
    return Math.min(Math.max(limit, 1), 100);
  }

  toItem(record: MedicineReminderRecord) {
    return {
      id: record.id,
      currentMedicineId: record.currentMedicineId,
      label: record.label,
      scheduledHour: record.scheduledHour,
      scheduledMinute: record.scheduledMinute,
      daysOfWeek: this.parseDaysOfWeek(record.daysOfWeek),
      startDate: formatDateOnly(record.startDate),
      endDate: formatDateOnly(record.endDate),
      isActive: record.isActive,
      note: record.note,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  toDeliveryItem(record: ReminderDeliveryRecord) {
    return {
      id: record.id,
      reminderId: record.reminderId,
      deviceId: record.deviceId,
      channel: record.channel,
      status: record.status,
      scheduledFor: record.scheduledFor.toISOString(),
      deliveredAt: record.deliveredAt?.toISOString() ?? null,
      errorMessage: record.errorMessage,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private normalizeDaysOfWeek(value: number[] | null | undefined) {
    if (value == null) {
      return Prisma.JsonNull;
    }

    const unique = Array.from(new Set(value)).sort((a, b) => a - b);
    if (unique.length === 0) {
      badRequest(this.i18n.t('medicine-reminders.days_of_week_empty'));
    }

    return unique;
  }

  private parseDaysOfWeek(value: unknown) {
    if (!Array.isArray(value)) {
      return null;
    }

    return value.filter((day): day is number => typeof day === 'number');
  }

  private parseOptionalDate(value: string | null | undefined) {
    if (value == null) {
      return null;
    }

    return this.parseRequiredDate(value);
  }

  private parseRequiredDate(value: string) {
    const parsed = parseDateOnly(value);
    if (Number.isNaN(parsed.getTime())) {
      badRequest(this.i18n.t('medicine-reminders.invalid_date'));
    }

    return parsed;
  }

  private assertValidDateWindow(startDate: Date | null, endDate: Date | null) {
    if (startDate != null && endDate != null && endDate < startDate) {
      badRequest(this.i18n.t('medicine-reminders.end_before_start'));
    }
  }
}
