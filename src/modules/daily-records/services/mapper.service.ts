import { normalizeNullableText } from '../../../common/helpers/string.utils';
import { formatDateOnly } from '../../../common/helpers/date-time.utils';
import { parseDateOnly } from '../../../common/helpers/date-time.utils';
import { toNullableInputJsonValue } from '../../../common/helpers/json.utils';
import { Injectable } from '@nestjs/common';
import type {
  DailyRecordAttachmentInputDto,
  UpdateDailyRecordDto,
} from '../dto';
import type { DailyRecordShape } from '../types/types';
import {
  DailyRecordAttachmentKind,
  DailyRecordKind,
  Prisma,
} from '#generated/prisma/client';
import {
  buildMealPayloadFromClientInput,
  getMealListSummary,
} from '../types/meal-analysis.types';
import type { OwnedRecordSnapshot } from './ownership.service';

interface DailyRecordItemOptions {
  includeMealPayload?: boolean;
}

@Injectable()
export class DailyRecordsMapperService {
  toRecordUpdateData(
    dto: UpdateDailyRecordDto,
    existing?: OwnedRecordSnapshot,
  ) {
    const data: Prisma.UserDailyRecordUpdateInput = {};
    const targetKind = dto.kind ?? existing?.kind ?? null;

    if (dto.kind !== undefined) {
      data.kind = dto.kind;
    }
    if (dto.occurredAt !== undefined) {
      data.occurredAt = parseDateOnly(dto.occurredAt);
    }
    if (dto.occurredTime !== undefined) {
      data.occurredTime = normalizeNullableText(dto.occurredTime);
    }
    if (dto.title !== undefined) {
      data.title = normalizeNullableText(dto.title);
    }
    if (dto.value !== undefined) {
      data.value = normalizeNullableText(dto.value);
    }
    if (dto.unit !== undefined) {
      data.unit = normalizeNullableText(dto.unit);
    }
    if (dto.note !== undefined) {
      data.note = normalizeNullableText(dto.note);
    }
    if (dto.payload !== undefined) {
      if (targetKind === DailyRecordKind.meal) {
        const payload = buildMealPayloadFromClientInput(
          dto.payload,
          existing?.payload,
        );
        data.payload = toNullableInputJsonValue(payload);
      } else {
        data.payload = toNullableInputJsonValue(dto.payload);
      }
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
      bucket: normalizeNullableText(attachment.bucket),
      provider: normalizeNullableText(attachment.provider),
      fileName: normalizeNullableText(attachment.fileName),
      contentType: normalizeNullableText(attachment.contentType),
      sizeBytes: attachment.sizeBytes ?? null,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      publicUrl: normalizeNullableText(attachment.publicUrl),
    }));
  }

  toItem(record: DailyRecordShape, options?: DailyRecordItemOptions) {
    const mealSummary =
      record.kind === DailyRecordKind.meal
        ? getMealListSummary(record.payload)
        : null;

    return {
      id: record.id,
      kind: record.kind,
      occurredAt: formatDateOnly(record.occurredAt),
      occurredTime: record.occurredTime,
      title: record.title,
      value: record.value,
      unit: record.unit,
      note: record.note,
      source: record.source,
      payload:
        record.kind === DailyRecordKind.meal
          ? options?.includeMealPayload === true
            ? (record.payload as Record<string, unknown> | null)
            : null
          : (record.payload as Record<string, unknown> | null),
      mealAnalysisStatus: mealSummary?.mealAnalysisStatus ?? null,
      mealAnalysisCoverage: mealSummary?.mealAnalysisCoverage ?? null,
      mealAnalysisUpdatedAt: mealSummary?.mealAnalysisUpdatedAt ?? null,
      mealAnalysisFailureReason: mealSummary?.mealAnalysisFailureReason ?? null,
      mealShortDescription: mealSummary?.mealShortDescription ?? null,
      mealTopFoods: mealSummary?.mealTopFoods ?? [],
      attachments: record.attachments.map((attachment) => ({
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
