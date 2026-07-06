import { Injectable } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  type CreateDataExportRequestDto,
  type DataExportRequestDataDto,
} from '../dto';
import { DataExportStorageService } from './storage.service';
import { DataExportQueueService } from './queue.service';
import { DataExportProcessorService } from './processor.service';

const DEFAULT_EXPORT_RANGE = 'last_7_days';
const MONTHLY_EXPORT_RANGE = 'last_30_days';

const dataExportSelect = {
  id: true,
  kind: true,
  format: true,
  range: true,
  status: true,
  createdAt: true,
  completedAt: true,
  downloadUrl: true,
  objectKey: true,
  fileName: true,
  fileSizeBytes: true,
  errorMessage: true,
} satisfies Prisma.DataExportRequestSelect;

type DataExportRequestRow = Prisma.DataExportRequestGetPayload<{
  select: typeof dataExportSelect;
}>;

@Injectable()
export class DataExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: DataExportStorageService,
    private readonly queueService: DataExportQueueService,
    private readonly processor: DataExportProcessorService,
  ) {}

  async createRequest(
    userId: string,
    dto: CreateDataExportRequestDto,
    language: string,
  ): Promise<DataExportRequestDataDto> {
    const kind = dto.kind ?? 'hospital';
    const format = dto.format ?? 'pdf';
    const requestedRange = dto.range ?? DEFAULT_EXPORT_RANGE;
    const effectiveRange =
      kind === 'monthly' ? MONTHLY_EXPORT_RANGE : requestedRange;

    if (!this.storageService.isConfigured()) {
      const created = await this.prisma.dataExportRequest.create({
        data: {
          userId,
          kind,
          format,
          range: effectiveRange,
          status: 'unavailable',
          errorMessage: 'Tencent COS export storage is not configured',
        },
      });
      return this.toDto(created);
    }

    const created = await this.prisma.dataExportRequest.create({
      data: {
        userId,
        kind,
        format,
        range: effectiveRange,
        status: 'requested',
      },
    });

    // Enqueue async processing via BullMQ
    if (this.queueService.isConfigured) {
      await this.queueService.enqueue({
        exportRequestId: created.id,
        userId,
        language,
      });
      return this.toDto(created);
    }

    // Fallback: synchronous inline processing when queue is unavailable
    await this.processor.process({
      exportRequestId: created.id,
      userId,
      language,
    });

    const completed = await this.prisma.dataExportRequest.findUniqueOrThrow({
      where: { id: created.id },
    });

    return this.toDto(completed);
  }

  async getLatestRequest(
    userId: string,
  ): Promise<DataExportRequestDataDto | null> {
    const row = await this.prisma.dataExportRequest.findFirst({
      select: dataExportSelect,
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return row ? this.toDto(row) : null;
  }

  private toDto(row: DataExportRequestRow): DataExportRequestDataDto {
    return {
      id: row.id,
      kind: row.kind,
      format: row.format,
      range: row.range,
      status: row.status,
      requestedAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      downloadUrl:
        row.downloadUrl ?? this.storageService.createDownloadUrl(row.objectKey),
      fileName: row.fileName,
      fileSizeBytes: row.fileSizeBytes,
      errorMessage: row.errorMessage,
    } as DataExportRequestDataDto;
  }
}
