import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateMedicineReminderDto,
  UpdateMedicineReminderDto,
} from './dto';

type MedicineReminderRecord = {
  id: string;
  currentMedicineId: string | null;
  label: string | null;
  scheduledHour: number;
  scheduledMinute: number;
  daysOfWeek: Prisma.JsonValue | null;
  startDate: Date | null;
  endDate: Date | null;
  isActive: boolean;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ReminderDeliveryRecord = {
  id: string;
  reminderId: string | null;
  deviceId: string | null;
  channel: string;
  status: string;
  scheduledFor: Date;
  deliveredAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
};

@Injectable()
export class MedicineRemindersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, activeOnly = false) {
    const items = await this.prisma.userMedicineReminder.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: [
        { scheduledHour: 'asc' },
        { scheduledMinute: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    return { items: items.map((item) => this.toItem(item)) };
  }

  async create(userId: string, dto: CreateMedicineReminderDto) {
    await this.ensureCurrentMedicineOwnedByUser(
      userId,
      dto.currentMedicineId ?? null,
    );
    const startDate = this.parseOptionalDate(dto.startDate);
    const endDate = this.parseOptionalDate(dto.endDate);
    this.assertValidDateWindow(startDate, endDate);

    const record = await this.prisma.userMedicineReminder.create({
      data: {
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
      },
    });

    return this.toItem(record);
  }

  async update(userId: string, id: string, dto: UpdateMedicineReminderDto) {
    const existing = await this.ensureOwnedByUser(userId, id);

    const data: Prisma.UserMedicineReminderUpdateInput = {};
    if (dto.currentMedicineId !== undefined) {
      await this.ensureCurrentMedicineOwnedByUser(
        userId,
        dto.currentMedicineId,
      );
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

    const record = await this.prisma.userMedicineReminder.update({
      where: { id },
      data,
    });

    return this.toItem(record);
  }

  async delete(userId: string, id: string) {
    await this.ensureOwnedByUser(userId, id);
    await this.prisma.userMedicineReminder.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async listDeliveries(userId: string, date?: string, limit = 20) {
    const cappedLimit = Math.min(Math.max(limit, 1), 100);
    const where: Prisma.UserReminderDeliveryWhereInput = { userId };
    if (date != null && date.trim().length > 0) {
      const start = this.parseRequiredDate(date);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      where.scheduledFor = { gte: start, lt: end };
    }

    const items = await this.prisma.userReminderDelivery.findMany({
      where,
      orderBy: [{ scheduledFor: 'desc' }, { createdAt: 'desc' }],
      take: cappedLimit,
    });

    return { items: items.map((item) => this.toDeliveryItem(item)) };
  }

  private normalizeNullableText(value: string | null | undefined) {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private normalizeDaysOfWeek(value: number[] | null | undefined) {
    if (value == null) return Prisma.JsonNull;
    const unique = Array.from(new Set(value)).sort((a, b) => a - b);
    if (unique.length === 0) {
      throw new BadRequestException({
        code: ResultCode.BAD_REQUEST,
        message: 'daysOfWeek must not be empty',
      });
    }
    return unique;
  }

  private parseDaysOfWeek(value: Prisma.JsonValue | null) {
    if (!Array.isArray(value)) return null;
    return value.filter((day): day is number => typeof day === 'number');
  }

  private parseOptionalDate(value: string | null | undefined) {
    if (value == null) return null;
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

  private toItem(record: MedicineReminderRecord) {
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

  private toDeliveryItem(record: ReminderDeliveryRecord) {
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

  private async ensureCurrentMedicineOwnedByUser(
    userId: string,
    currentMedicineId: string | null,
  ) {
    if (currentMedicineId == null) return;
    const medicine = await this.prisma.userCurrentMedicine.findFirst({
      where: { id: currentMedicineId, userId, isCurrent: true },
      select: { id: true },
    });
    if (medicine == null) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: 'Medicine not found',
      });
    }
  }

  private async ensureOwnedByUser(userId: string, id: string) {
    const reminder = await this.prisma.userMedicineReminder.findFirst({
      where: { id, deletedAt: null },
      select: { userId: true, startDate: true, endDate: true },
    });
    if (!reminder || reminder.userId !== userId) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: 'Reminder not found',
      });
    }
    return reminder;
  }
}
