import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ResultCode } from '../../../common/api-envelope';
import type {
  CreateMedicineReminderDto,
  UpdateMedicineReminderDto,
} from '../dto';
import type {
  MedicineReminderRecord,
  OwnedMedicineReminderRecord,
  ReminderDeliveryRecord,
} from '../types/medicine-reminders.types';

@Injectable()
export class MedicineRemindersMapperService {
  toCreateData(userId: string, dto: CreateMedicineReminderDto) {
    const startDate = this.parseOptionalDate(dto.startDate);
    const endDate = this.parseOptionalDate(dto.endDate);
    this.assertValidDateWindow(startDate, endDate);

    return {
      userId,
      currentMedicineId: dto.currentMedicineId ?? null,
      label: this.normalizeNullableText(dto.label),
      scheduledHour: dto.scheduledHour,
      scheduledMinute: dto.scheduledMinute,
      daysOfWeek: this.normalizeDaysOfWeek(dto.daysOfWeek),
      startDate,
      endDate,
      isActive: dto.isActive ?? true,
      note: this.normalizeNullableText(dto.note),
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
      data.label = this.normalizeNullableText(dto.label);
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
      data.note = this.normalizeNullableText(dto.note);
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
      startDate: record.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: record.endDate?.toISOString().slice(0, 10) ?? null,
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

  private normalizeNullableText(value: string | null | undefined) {
    if (value == null) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private normalizeDaysOfWeek(value: number[] | null | undefined) {
    if (value == null) {
      return Prisma.JsonNull;
    }

    const unique = Array.from(new Set(value)).sort((a, b) => a - b);
    if (unique.length === 0) {
      throw new BadRequestException({
        code: ResultCode.BAD_REQUEST,
        message: 'daysOfWeek must not be empty',
      });
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
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException({
        code: ResultCode.BAD_REQUEST,
        message: 'Invalid date',
      });
    }

    return parsed;
  }

  private assertValidDateWindow(startDate: Date | null, endDate: Date | null) {
    if (startDate != null && endDate != null && endDate < startDate) {
      throw new BadRequestException({
        code: ResultCode.BAD_REQUEST,
        message: 'endDate must not be before startDate',
      });
    }
  }
}
