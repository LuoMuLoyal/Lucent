import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DailyRecordAttachmentKind,
  DailyRecordKind,
  Prisma,
} from '../../generated/prisma/client';
import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateDailyRecordDto,
  DailyRecordAttachmentInputDto,
  UpdateDailyRecordDto,
} from './dto';

type DailyRecordAttachmentShape = {
  id: string;
  kind: DailyRecordAttachmentKind;
  objectKey: string;
  bucket: string | null;
  provider: string | null;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  publicUrl: string | null;
  createdAt: Date;
};

type DailyRecordShape = {
  id: string;
  kind: DailyRecordKind;
  occurredAt: Date;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
  attachments?: DailyRecordAttachmentShape[];
};

type DailyRecordDbClient = Pick<
  PrismaService,
  'userDailyRecord' | 'userDailyRecordAttachment'
>;

const dailyRecordWithAttachments = {
  attachments: {
    orderBy: { createdAt: Prisma.SortOrder.asc },
  },
} satisfies Prisma.UserDailyRecordInclude;

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
        include: dailyRecordWithAttachments,
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
          data: this.toAttachmentCreateManyData(
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

    return this.toItem(record);
  }

  async get(userId: string, id: string) {
    return this.getItemFromDb(this.prisma, userId, id);
  }

  async update(userId: string, id: string, dto: UpdateDailyRecordDto) {
    await this.ensureOwnedByUser(userId, id);

    const updateAttachments = dto.attachments;
    if (updateAttachments !== undefined) {
      return this.prisma.$transaction(async (tx) => {
        await tx.userDailyRecord.update({
          where: { id },
          data: this.toRecordUpdateData(dto),
        });
        await tx.userDailyRecordAttachment.deleteMany({
          where: { userId, recordId: id },
        });
        if (updateAttachments.length > 0) {
          await tx.userDailyRecordAttachment.createMany({
            data: this.toAttachmentCreateManyData(
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
      data: this.toRecordUpdateData(dto),
      include: dailyRecordWithAttachments,
    });

    return this.toItem(record);
  }

  private toRecordUpdateData(dto: UpdateDailyRecordDto) {
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

    return data;
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
      include: dailyRecordWithAttachments,
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

  private toAttachmentCreateManyData(
    userId: string,
    recordId: string,
    attachments: DailyRecordAttachmentInputDto[],
  ) {
    return attachments.map((attachment) => ({
      userId,
      recordId,
      kind: attachment.kind ?? DailyRecordAttachmentKind.image,
      objectKey: attachment.objectKey.trim(),
      bucket: attachment.bucket?.trim() ?? null,
      provider: attachment.provider?.trim() ?? null,
      fileName: attachment.fileName?.trim() ?? null,
      contentType: attachment.contentType?.trim() ?? null,
      sizeBytes: attachment.sizeBytes ?? null,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      publicUrl: attachment.publicUrl?.trim() ?? null,
    }));
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
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: 'Record not found',
      });
    }

    return this.toItem(record);
  }

  private toItem(record: DailyRecordShape) {
    return {
      id: record.id,
      kind: record.kind,
      occurredAt: record.occurredAt.toISOString().slice(0, 10),
      title: record.title,
      value: record.value,
      unit: record.unit,
      note: record.note,
      source: record.source,
      attachments: (record.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        objectKey: attachment.objectKey,
        bucket: attachment.bucket,
        provider: attachment.provider,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        width: attachment.width,
        height: attachment.height,
        publicUrl: attachment.publicUrl,
        createdAt: attachment.createdAt.toISOString(),
      })),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private async ensureOwnedByUser(userId: string, id: string) {
    const record = await this.prisma.userDailyRecord.findFirst({
      where: { id, deletedAt: null },
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
