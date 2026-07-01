import { nonDeleted } from '../../../common/utils/prisma.helpers';
import { normalizeNullableText } from '../../../common/utils/string.utils';
import { parseDateOnly } from '../../../common/utils/date-time.utils';
import { BadRequestException, Injectable } from '@nestjs/common';
import { DailyRecordKind, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { CreateDailyRecordDto, UpdateDailyRecordDto } from '../dto';
import { DailyRecordsOwnershipService } from './ownership.service';
import { DailyRecordsMapperService } from './daily-records-mapper.service';
import {
  dailyRecordWithAttachments,
  type DailyRecordDbClient,
} from '../types/daily-records.types';
import {
  buildMealPayloadFromClientInput,
  getMealSourceRevision,
  markMealAnalysisQueued,
  type MealAnalysisCoverage,
  type MealAnalysisStatus,
} from '../types/meal-analysis.types';
import { MealAnalysisQueueService } from './meal-analysis-queue.service';

@Injectable()
export class DailyRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownershipService: DailyRecordsOwnershipService,
    private readonly mapperService: DailyRecordsMapperService,
    private readonly mealAnalysisQueueService: MealAnalysisQueueService,
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
      occurredAt: parseDateOnly(date),
      ...nonDeleted,
      ...(kind != null ? { kind: kind as DailyRecordKind } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.userDailyRecord.findMany({
        where,
        include: dailyRecordWithAttachments,
        orderBy: [
          { occurredTime: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
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
    this.ensureValidSleepPayload(dto.kind, dto.payload);

    const createAttachments = dto.attachments;
    const initialMealPayload =
      dto.kind === DailyRecordKind.meal
        ? this.prepareMealPayloadForWrite(dto.payload, createAttachments)
        : null;

    const baseData = {
      userId,
      kind: dto.kind,
      occurredAt: parseDateOnly(dto.occurredAt),
      occurredTime: normalizeNullableText(dto.occurredTime),
      title: normalizeNullableText(dto.title),
      value: normalizeNullableText(dto.value),
      unit: normalizeNullableText(dto.unit),
      note: normalizeNullableText(dto.note),
    };

    const payloadField =
      dto.kind === DailyRecordKind.meal
        ? this.buildMealCreateFields(initialMealPayload)
        : dto.payload === undefined
          ? {}
          : { payload: dto.payload as Prisma.InputJsonValue };

    if (createAttachments !== undefined && createAttachments.length > 0) {
      return this.prisma.$transaction(async (tx) => {
        const record = await tx.userDailyRecord.create({
          data: { ...baseData, ...payloadField },
        });
        let queuedRevision: number | null = null;
        await tx.userDailyRecordAttachment.createMany({
          data: this.mapperService.toAttachmentCreateManyData(
            userId,
            record.id,
            createAttachments,
          ),
        });
        if (
          dto.kind === DailyRecordKind.meal &&
          createAttachments.length === 1
        ) {
          const attachment = createAttachments[0];
          if (attachment == null) {
            throw new Error('Expected one meal attachment after length check.');
          }
          const queuedPayload = markMealAnalysisQueued(record.payload, {
            imageObjectKey: attachment.objectKey,
          });
          queuedRevision = getMealSourceRevision(queuedPayload);
          await tx.userDailyRecord.update({
            where: { id: record.id },
            data: this.withMealHotFields({}, queuedPayload),
          });
        }
        const item = await this.getItemFromDb(tx, userId, record.id);
        await this.enqueueMealAnalysisIfNeeded(
          userId,
          item,
          queuedRevision ?? undefined,
        );
        return item;
      });
    }

    const record = await this.prisma.userDailyRecord.create({
      data: { ...baseData, ...payloadField },
      include: dailyRecordWithAttachments,
    });

    const item = this.mapperService.toItem(record, {
      includeMealPayload: true,
    });
    await this.enqueueMealAnalysisIfNeeded(userId, item);
    return item;
  }

  async get(userId: string, id: string) {
    return this.getItemFromDb(this.prisma, userId, id);
  }

  async update(userId: string, id: string, dto: UpdateDailyRecordDto) {
    const existing = await this.ownershipService.ensureOwnedByUser(userId, id);
    this.ensureValidSleepFinalState(dto, existing);

    const updateAttachments = dto.attachments;
    const nextPayload =
      (dto.payload !== undefined || updateAttachments !== undefined) &&
      (dto.kind ?? existing.kind) === DailyRecordKind.meal
        ? this.prepareMealPayloadForWrite(
            dto.payload !== undefined ? dto.payload : existing.payload,
            updateAttachments,
            existing.payload,
          )
        : null;
    if (updateAttachments !== undefined) {
      return this.prisma.$transaction(async (tx) => {
        await tx.userDailyRecord.update({
          where: { id },
          data: this.withMealHotFields(
            this.mapperService.toRecordUpdateData(dto, existing),
            nextPayload,
          ),
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
        const item = await this.getItemFromDb(tx, userId, id);
        await this.enqueueMealAnalysisIfNeeded(
          userId,
          item,
          nextPayload == null ? undefined : getMealSourceRevision(nextPayload),
        );
        return item;
      });
    }

    const record = await this.prisma.userDailyRecord.update({
      where: { id },
      data: this.withMealHotFields(
        this.mapperService.toRecordUpdateData(dto, existing),
        nextPayload,
      ),
      include: dailyRecordWithAttachments,
    });

    const item = this.mapperService.toItem(record, {
      includeMealPayload: true,
    });
    await this.enqueueMealAnalysisIfNeeded(userId, item);
    return item;
  }

  async delete(userId: string, id: string) {
    await this.ownershipService.ensureOwnedByUser(userId, id);

    await this.prisma.userDailyRecord.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async summary(userId: string, date: string) {
    const records = await this.prisma.userDailyRecord.findMany({
      where: {
        userId,
        occurredAt: parseDateOnly(date),
        ...nonDeleted,
      },
      include: dailyRecordWithAttachments,
      orderBy: [
        { occurredTime: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });

    return this.mapperService.toSummaries(records);
  }

  private ensureValidSleepPayload(
    kind: string,
    payload: Record<string, unknown> | undefined,
  ) {
    if (kind !== DailyRecordKind.sleep) return;
    if (payload == null || typeof payload['durationMinutes'] !== 'number') {
      throw new BadRequestException(
        'Sleep records require payload.durationMinutes as a positive number.',
      );
    }
    if (payload['durationMinutes'] <= 0) {
      throw new BadRequestException(
        'Sleep payload.durationMinutes must be a positive number.',
      );
    }
  }

  private ensureValidSleepFinalState(
    dto: UpdateDailyRecordDto,
    existing: { kind: DailyRecordKind; payload: unknown },
  ) {
    const finalKind = dto.kind !== undefined ? dto.kind : existing.kind;
    if (finalKind !== DailyRecordKind.sleep) return;

    const rawPayload =
      dto.payload !== undefined ? dto.payload : existing.payload;
    const payload = rawPayload as Record<string, unknown> | null;

    if (payload == null || typeof payload['durationMinutes'] !== 'number') {
      throw new BadRequestException(
        'Sleep records require payload.durationMinutes as a positive number.',
      );
    }
    if (payload['durationMinutes'] <= 0) {
      throw new BadRequestException(
        'Sleep payload.durationMinutes must be a positive number.',
      );
    }
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
      this.ownershipService.throwRecordNotFound();
    }

    return this.mapperService.toItem(record, { includeMealPayload: true });
  }

  private prepareMealPayloadForWrite(
    payload: unknown,
    attachments: { objectKey: string }[] | undefined,
    existingPayload?: unknown,
  ) {
    const sanitized = buildMealPayloadFromClientInput(
      payload,
      existingPayload ?? null,
    );
    if (attachments == null || attachments.length !== 1) {
      return sanitized;
    }
    const attachment = attachments[0];
    if (attachment == null) {
      return sanitized;
    }

    return markMealAnalysisQueued(sanitized, {
      imageObjectKey: attachment.objectKey,
    });
  }

  private withMealHotFields(
    data: Prisma.UserDailyRecordUpdateInput,
    mealPayload: Record<string, unknown> | null,
  ): Prisma.UserDailyRecordUpdateInput {
    if (mealPayload == null) {
      return data;
    }

    const analysis = mealPayload['mealAnalysis'] as
      | Record<string, unknown>
      | undefined;
    return {
      ...data,
      payload: mealPayload as Prisma.InputJsonValue,
      mealAnalysisStatus:
        (analysis?.['analysisStatus'] as
          | MealAnalysisStatus
          | null
          | undefined) ?? null,
      mealAnalysisCoverage:
        (analysis?.['coverage'] as MealAnalysisCoverage | null | undefined) ??
        null,
      mealAnalysisUpdatedAt: null,
      mealAnalysisFailureReason: null,
      mealSourceRevision: getMealSourceRevision(mealPayload),
    };
  }

  private async enqueueMealAnalysisIfNeeded(
    userId: string,
    item: {
      id: string;
      kind: DailyRecordKind;
      attachments: Array<{ objectKey: string }>;
      payload?: Record<string, unknown> | null;
    },
    sourceRevisionOverride?: number,
  ) {
    if (item.kind !== DailyRecordKind.meal || item.attachments.length !== 1) {
      return;
    }

    await this.mealAnalysisQueueService.enqueue({
      userId,
      recordId: item.id,
      sourceRevision:
        sourceRevisionOverride ?? getMealSourceRevision(item.payload),
    });
  }

  private buildMealCreateFields(
    mealPayload: Record<string, unknown> | null,
  ): Record<string, unknown> {
    if (mealPayload == null) {
      return {};
    }

    const analysis = mealPayload['mealAnalysis'] as
      | Record<string, unknown>
      | undefined;
    return {
      payload: mealPayload,
      mealAnalysisStatus: analysis?.['analysisStatus'] ?? null,
      mealAnalysisCoverage: analysis?.['coverage'] ?? null,
      mealSourceRevision: getMealSourceRevision(mealPayload),
    };
  }
}
