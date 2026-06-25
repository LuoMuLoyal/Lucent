import { notFound } from '../../common/utils/api-errors';
import { nonDeleted } from '../../common/utils/prisma.helpers';
import { normalizeNullableText } from '../../common/utils/string.utils';
import { formatDateOnly } from '../../common/utils/date-time.utils';
import { parseDateOnly } from '../../common/utils/date-time.utils';
import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateDoseLogDto, UpdateDoseLogDto } from './dto';

@Injectable()
export class MedicineDoseLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, date: string) {
    const where: Prisma.UserMedicineDoseLogWhereInput = {
      userId,
      scheduledFor: parseDateOnly(date),
      ...nonDeleted,
    };
    const items = await this.prisma.userMedicineDoseLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return { items: items.map((r) => this.toItem(r)) };
  }

  async create(userId: string, dto: CreateDoseLogDto) {
    if (dto.currentMedicineId) {
      const med = await this.prisma.userCurrentMedicine.findUnique({
        where: { id: dto.currentMedicineId },
        select: { userId: true },
      });
      if (!med || med.userId !== userId) {
        notFound('Medicine not found');
      }
    }
    const record = await this.prisma.userMedicineDoseLog.create({
      data: {
        userId,
        currentMedicineId: dto.currentMedicineId ?? null,
        status: dto.status,
        scheduledFor: parseDateOnly(dto.scheduledFor),
        doseText: normalizeNullableText(dto.doseText),
        note: normalizeNullableText(dto.note),
      },
    });
    return this.toItem(record);
  }

  async update(userId: string, id: string, dto: UpdateDoseLogDto) {
    await this.ensureOwned(userId, id);
    const data: Prisma.UserMedicineDoseLogUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.doseText !== undefined)
      data.doseText = normalizeNullableText(dto.doseText);
    if (dto.note !== undefined) data.note = normalizeNullableText(dto.note);
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
      data: { deletedAt: new Date() },
    });
  }

  private toItem(r: Prisma.UserMedicineDoseLogGetPayload<object>) {
    return {
      id: r.id,
      currentMedicineId: r.currentMedicineId,
      status: r.status,
      scheduledFor: formatDateOnly(r.scheduledFor),
      doseText: r.doseText,
      note: r.note,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async ensureOwned(userId: string, id: string) {
    const r = await this.prisma.userMedicineDoseLog.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!r || r.userId !== userId) notFound('Not found');
  }
}
