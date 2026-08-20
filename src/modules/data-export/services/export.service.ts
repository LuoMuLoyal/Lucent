import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';
import type {
  CreateDataExportRequestDto,
  DataExportRequestDataDto,
} from '../dto/export-response.dto';
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

/**
 * Manages report PDF generation requests.
 *
 * Despite the class name, this service does NOT export raw user data. It
 * creates `DataExportRequest` records and enqueues PDF report generation
 * via `DataExportProcessorService`.
 *
 * (Architecture review #14 — naming boundary documented.)
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

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
          errorMessage: 'Object storage is not configured',
        },
      });
      return await this.toDto(created);
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
      try {
        await this.queueService.enqueue({
          exportRequestId: created.id,
          userId,
          language,
        });
        return await this.toDto(created);
      } catch (error) {
        // Redis 配置但断连：记日志后走下方 inline 同步处理，避免 500 丢任务。
        this.logger.error(
          `Failed to enqueue data export ${created.id}, processing inline: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      }
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

    return await this.toDto(completed);
  }

  async getLatestRequest(
    userId: string,
  ): Promise<DataExportRequestDataDto | null> {
    const row = await this.prisma.dataExportRequest.findFirst({
      select: dataExportSelect,
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return row ? await this.toDto(row) : null;
  }

  private async toDto(
    row: DataExportRequestRow,
  ): Promise<DataExportRequestDataDto> {
    return {
      id: row.id,
      kind: row.kind,
      format: row.format,
      range: row.range,
      status: row.status,
      requestedAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      downloadUrl:
        row.downloadUrl ??
        (await this.storageService.createDownloadUrl(row.objectKey)),
      fileName: row.fileName,
      fileSizeBytes: row.fileSizeBytes,
      errorMessage: row.errorMessage,
    } as DataExportRequestDataDto;
  }
}
