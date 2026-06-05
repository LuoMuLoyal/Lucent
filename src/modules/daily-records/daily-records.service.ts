import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateDailyRecordDto, UpdateDailyRecordDto } from './dto';

@Injectable()
export class DailyRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    date: string,
    kind?: string,
    page = 1,
    pageSize = 50,
  ) {
    const where: Prisma.UserDailyRecordWhereInput = {
      userId,
      occurredAt: new Date(`${date}T00:00:00.000Z`),
      deletedAt: null,
    };

    if (kind != null) {
      (where as Record<string, unknown>)['kind'] = kind;
    }

    const [items, total] = await Promise.all([
      this.prisma.userDailyRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.userDailyRecord.count({ where }),
    ]);

    return {
      items: items.map((r) => this.toItem(r)),
      total,
    };
  }

  async create(userId: string, dto: CreateDailyRecordDto) {
    const record = await this.prisma.userDailyRecord.create({
      data: {
        userId,
        kind: dto.kind,
        occurredAt: new Date(`${dto.occurredAt}T00:00:00.000Z`),
        title: dto.title?.trim() ?? null,
        value: dto.value?.trim() ?? null,
        unit: dto.unit?.trim() ?? null,
        note: dto.note?.trim() ?? null,
      },
    });

    return this.toItem(record);
  }

  async update(userId: string, id: string, dto: UpdateDailyRecordDto) {
    await this.ensureOwnedByUser(userId, id);

    const data: Prisma.UserDailyRecordUpdateInput = {};

    if (dto.kind !== undefined) {
      data.kind = dto.kind;
    }
    if (dto.occurredAt !== undefined) {
      data.occurredAt = new Date(`${dto.occurredAt}T00:00:00.000Z`);
    }
    if (dto.title !== undefined) {
      data.title = dto.title?.trim() ?? null;
    }
    if (dto.value !== undefined) {
      data.value = dto.value?.trim() ?? null;
    }
    if (dto.unit !== undefined) {
      data.unit = dto.unit?.trim() ?? null;
    }
    if (dto.note !== undefined) {
      data.note = dto.note?.trim() ?? null;
    }

    const record = await this.prisma.userDailyRecord.update({
      where: { id },
      data,
    });

    return this.toItem(record);
  }

  async delete(userId: string, id: string) {
    await this.ensureOwnedByUser(userId, id);

    await this.prisma.userDailyRecord.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async summary(userId: string, date: string) {
    const records = await this.prisma.userDailyRecord.findMany({
      where: {
        userId,
        occurredAt: new Date(`${date}T00:00:00.000Z`),
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    const byKind = new Map<string, typeof records>();
    for (const r of records) {
      const list = byKind.get(r.kind) ?? [];
      list.push(r);
      byKind.set(r.kind, list);
    }

    return {
      summaries: Array.from(byKind.entries()).map(([kind, items]) => ({
        kind,
        count: items.length,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        latest: items.length > 0 ? this.toItem(items[0]!) : null,
      })),
    };
  }

  private toItem(record: Prisma.UserDailyRecordGetPayload<object>) {
    return {
      id: record.id,
      kind: record.kind,
      occurredAt: record.occurredAt.toISOString().slice(0, 10),
      title: record.title,
      value: record.value,
      unit: record.unit,
      note: record.note,
      source: record.source,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private async ensureOwnedByUser(userId: string, id: string) {
    const record = await this.prisma.userDailyRecord.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!record || record.userId !== userId) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: 'Record not found',
      });
    }
  }
}
