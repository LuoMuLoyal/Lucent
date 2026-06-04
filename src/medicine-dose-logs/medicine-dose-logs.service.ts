import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { ResultCode } from '../common/api-envelope';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDoseLogDto, UpdateDoseLogDto } from './dto';

@Injectable()
export class MedicineDoseLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, date: string) {
    const where: Prisma.UserMedicineDoseLogWhereInput = {
      userId,
      scheduledFor: new Date(`${date}T00:00:00.000Z`),
      deletedAt: null,
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
        throw new NotFoundException({
          code: ResultCode.NOT_FOUND,
          message: 'Medicine not found',
        });
      }
    }
    const record = await this.prisma.userMedicineDoseLog.create({
      data: {
        userId,
        currentMedicineId: dto.currentMedicineId ?? null,
        status: dto.status,
        scheduledFor: new Date(`${dto.scheduledFor}T00:00:00.000Z`),
        doseText: dto.doseText?.trim() ?? null,
        note: dto.note?.trim() ?? null,
      },
    });
    return this.toItem(record);
  }

  async update(userId: string, id: string, dto: UpdateDoseLogDto) {
    await this.ensureOwned(userId, id);
    const data: Prisma.UserMedicineDoseLogUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.doseText !== undefined)
      data.doseText = dto.doseText?.trim() ?? null;
    if (dto.note !== undefined) data.note = dto.note?.trim() ?? null;
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
      scheduledFor: r.scheduledFor.toISOString().slice(0, 10),
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
    if (!r || r.userId !== userId)
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: 'Not found',
      });
  }
}
