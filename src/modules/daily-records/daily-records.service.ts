import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateDailyRecordDto, UpdateDailyRecordDto } from './dto';
import { DailyRecordsGuardService } from './daily-records-guard.service';
import { DailyRecordsMapperService } from './daily-records-mapper.service';
import {
  dailyRecordWithAttachments,
  type DailyRecordDbClient,
} from './daily-records.types';

@Injectable()
export class DailyRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guardService: DailyRecordsGuardService,
    private readonly mapperService: DailyRecordsMapperService,
  ) {}

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
        include: dailyRecordWithAttachments,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.userDailyRecord.count({ where }),
    ]);

    return {
      items: items.map((record) => this.mapperService.toItem(record)),
      total,
    };
  }

  async create(userId: string, dto: CreateDailyRecordDto) {
    const createAttachments = dto.attachments;
    if (createAttachments !== undefined && createAttachments.length > 0) {
      return this.prisma.$transaction(async (tx) => {
        const record = await tx.userDailyRecord.create({
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
        await tx.userDailyRecordAttachment.createMany({
          data: this.mapperService.toAttachmentCreateManyData(
            userId,
            record.id,
            createAttachments,
          ),
        });
        return this.getItemFromDb(tx, userId, record.id);
      });
    }

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
      include: dailyRecordWithAttachments,
    });

    return this.mapperService.toItem(record);
  }

  async get(userId: string, id: string) {
    return this.getItemFromDb(this.prisma, userId, id);
  }

  async update(userId: string, id: string, dto: UpdateDailyRecordDto) {
    await this.guardService.ensureOwnedByUser(userId, id);

    const updateAttachments = dto.attachments;
    if (updateAttachments !== undefined) {
      return this.prisma.$transaction(async (tx) => {
        await tx.userDailyRecord.update({
          where: { id },
          data: this.mapperService.toRecordUpdateData(dto),
        });
        await tx.userDailyRecordAttachment.deleteMany({
          where: { userId, recordId: id },
        });
        if (updateAttachments.length > 0) {
          await tx.userDailyRecordAttachment.createMany({
            data: this.mapperService.toAttachmentCreateManyData(
              userId,
              id,
              updateAttachments,
            ),
          });
        }
        return this.getItemFromDb(tx, userId, id);
      });
    }

    const record = await this.prisma.userDailyRecord.update({
      where: { id },
      data: this.mapperService.toRecordUpdateData(dto),
      include: dailyRecordWithAttachments,
    });

    return this.mapperService.toItem(record);
  }

  async delete(userId: string, id: string) {
    await this.guardService.ensureOwnedByUser(userId, id);

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
      include: dailyRecordWithAttachments,
      orderBy: { createdAt: 'desc' },
    });

    return this.mapperService.toSummaries(records);
  }

  private async getItemFromDb(
    db: DailyRecordDbClient,
    userId: string,
    id: string,
  ) {
    const record = await db.userDailyRecord.findFirst({
      where: { id, userId, deletedAt: null },
      include: dailyRecordWithAttachments,
    });

    if (record == null) {
      this.guardService.throwRecordNotFound();
    }

    return this.mapperService.toItem(record);
  }
}
