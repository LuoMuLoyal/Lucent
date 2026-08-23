import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';
import { fromPrismaResult } from '../../../common';
import {
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
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

  /**
   * Creates a data-export request.
   *
   * - Storage not configured → the request row is persisted with status
   *   `unavailable` and returned (documented contract, not an error).
   * - Queue available → enqueue for async processing.
   * - Queue unavailable / enqueue rejects (Redis down) → the request is
   *   processed synchronously inline so the task is never lost; a failed
   *   inline run propagates (the processor writes status `failed` and
   *   rethrows — queue-retry semantics, not HTTP retry).
   */
  createRequest(
    userId: string,
    dto: CreateDataExportRequestDto,
    language: string,
  ): ResultAsync<DataExportRequestDataDto, DomainFailure> {
    const kind = dto.kind ?? 'hospital';
    const format = dto.format ?? 'pdf';
    const requestedRange = dto.range ?? DEFAULT_EXPORT_RANGE;
    const effectiveRange =
      kind === 'monthly' ? MONTHLY_EXPORT_RANGE : requestedRange;

    if (!this.storageService.isConfigured()) {
      return fromPrismaResult(
        this.prisma.dataExportRequest.create({
          data: {
            userId,
            kind,
            format,
            range: effectiveRange,
            status: 'unavailable',
            errorMessage: 'Object storage is not configured',
          },
        }),
      ).andThen((created) => this.toDto(created));
    }

    return fromPrismaResult(
      this.prisma.dataExportRequest.create({
        data: {
          userId,
          kind,
          format,
          range: effectiveRange,
          status: 'requested',
        },
      }),
    ).andThen((created) =>
      this.dispatchOrProcessInline(created, userId, language),
    );
  }

  /**
   * Enqueues the request for async processing, falling back to synchronous
   * inline processing when the queue is unavailable or enqueueing rejects.
   */
  private dispatchOrProcessInline(
    created: DataExportRequestRow,
    userId: string,
    language: string,
  ): ResultAsync<DataExportRequestDataDto, DomainFailure> {
    if (!this.queueService.isConfigured) {
      return this.processInline(created, userId, language);
    }

    const work = (async (): Promise<DataExportRequestRow> => {
      try {
        await this.queueService.enqueue({
          exportRequestId: created.id,
          userId,
          language,
        });
        return created;
      } catch (error) {
        // Redis configured but disconnected: log and process inline so the
        // task is never lost (documented degradation, original behavior).
        this.logger.error(
          `Failed to enqueue data export ${created.id}, processing inline: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
        await this.processor.process({
          exportRequestId: created.id,
          userId,
          language,
        });
        return this.prisma.dataExportRequest.findUniqueOrThrow({
          where: { id: created.id },
        });
      }
    })();

    return fromPrismaResult(work).andThen((row) => this.toDto(row));
  }

  /**
   * Synchronous inline processing fallback. The processor writes the final
   * task status itself; a failure rethrows (BullMQ-style retry semantics are
   * the processor's contract — the HTTP layer does not retry).
   */
  private processInline(
    created: DataExportRequestRow,
    userId: string,
    language: string,
  ): ResultAsync<DataExportRequestDataDto, DomainFailure> {
    const work = (async (): Promise<DataExportRequestRow> => {
      await this.processor.process({
        exportRequestId: created.id,
        userId,
        language,
      });
      return this.prisma.dataExportRequest.findUniqueOrThrow({
        where: { id: created.id },
      });
    })();

    return fromPrismaResult(work).andThen((row) => this.toDto(row));
  }

  getLatestRequest(
    userId: string,
  ): ResultAsync<DataExportRequestDataDto | null, DomainFailure> {
    return fromPrismaResult(
      this.prisma.dataExportRequest.findFirst({
        select: dataExportSelect,
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
    ).andThen((row) => (row != null ? this.toDto(row) : okAsync(null)));
  }

  private toDto(
    row: DataExportRequestRow,
  ): ResultAsync<DataExportRequestDataDto, DomainFailure> {
    const downloadUrlResult =
      row.downloadUrl != null
        ? okAsync<string | null, DomainFailure>(row.downloadUrl)
        : this.storageService.createDownloadUrl(row.objectKey);

    return downloadUrlResult.map(
      (downloadUrl) =>
        ({
          id: row.id,
          kind: row.kind,
          format: row.format,
          range: row.range,
          status: row.status,
          requestedAt: row.createdAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          downloadUrl,
          fileName: row.fileName,
          fileSizeBytes: row.fileSizeBytes,
          errorMessage: row.errorMessage,
        }) as DataExportRequestDataDto,
    );
  }
}
