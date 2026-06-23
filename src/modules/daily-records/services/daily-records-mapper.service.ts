import { Injectable } from '@nestjs/common';
import type {
  DailyRecordAttachmentInputDto,
  UpdateDailyRecordDto,
} from '../dto';
import type { DailyRecordShape } from '../types/daily-records.types';
import {
  DailyRecordAttachmentKind,
  Prisma,
} from '../../../generated/prisma/client';

@Injectable()
export class DailyRecordsMapperService {
  toRecordUpdateData(dto: UpdateDailyRecordDto) {
    const data: Prisma.UserDailyRecordUpdateInput = {};

    if (dto.kind !== undefined) {
      data.kind = dto.kind;
    }
    if (dto.occurredAt !== undefined) {
      data.occurredAt = new Date(`${dto.occurredAt}T00:00:00.000Z`);
    }
    if (dto.occurredTime !== undefined) {
      data.occurredTime = dto.occurredTime?.trim() ?? null;
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
    if (dto.payload !== undefined) {
      data.payload =
        dto.payload === null
          ? Prisma.DbNull
          : (dto.payload as Prisma.InputJsonValue);
    }

    return data;
  }

  toAttachmentCreateManyData(
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

  toItem(record: DailyRecordShape) {
    return {
      id: record.id,
      kind: record.kind,
      occurredAt: record.occurredAt.toISOString().slice(0, 10),
      occurredTime: record.occurredTime,
      title: record.title,
      value: record.value,
      unit: record.unit,
      note: record.note,
      source: record.source,
      payload: (record.payload as Record<string, unknown> | null) ?? null,
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

  toSummaries(records: DailyRecordShape[]) {
    const byKind = new Map<string, DailyRecordShape[]>();
    for (const record of records) {
      const list = byKind.get(record.kind) ?? [];
      list.push(record);
      byKind.set(record.kind, list);
    }

    return {
      summaries: Array.from(byKind.entries()).map(([kind, items]) => ({
        kind,
        count: items.length,
        latest: (() => {
          const latestRecord = items[0];
          return latestRecord ? this.toItem(latestRecord) : null;
        })(),
      })),
    };
  }
}
