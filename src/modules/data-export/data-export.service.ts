import { formatDateOnly } from '../../common/utils/date-time.utils';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from '../reports/dashboard/reports.service';
import {
  type CreateDataExportRequestDto,
  type DataExportRequestDataDto,
} from './dto';
import { DataExportStorageService } from './services/data-export-storage.service';
import { DataExportQueueService } from './services/data-export-queue.service';
import { ReportExportPdfService } from './services/report-export-pdf.service';
import type { ReportDashboardDataDto } from '../reports/dto';

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
    private readonly reportsService: ReportsService,
    private readonly storageService: DataExportStorageService,
    private readonly reportExportPdfService: ReportExportPdfService,
    private readonly queueService: DataExportQueueService,
    private readonly notificationsService: NotificationsService,
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
    return this.processInline(created, userId, language);
  }

  private async processInline(
    row: DataExportRequestRow,
    userId: string,
    language: string,
  ): Promise<DataExportRequestDataDto> {
    const processing = await this.prisma.dataExportRequest.update({
      where: { id: row.id },
      data: { status: 'processing', errorMessage: null },
    });

    try {
      const report = await this.reportsService.getDashboard(
        userId,
        { range: row.range as 'last_7_days' | 'last_30_days' },
        language,
      );
      const pdf = await this._buildPdfForKind(row.kind, language, report);
      const fileName = this.createFileName(
        row.kind as CreateDataExportRequestDto['kind'],
        row.range as CreateDataExportRequestDto['range'],
      );
      const uploaded = await this.storageService.uploadPdf({
        userId,
        fileName,
        body: pdf,
      });

      const completed = await this.prisma.dataExportRequest.update({
        where: { id: processing.id },
        data: {
          status: 'completed',
          objectKey: uploaded.objectKey,
          bucket: uploaded.bucket,
          provider: uploaded.provider,
          fileName,
          fileSizeBytes: uploaded.fileSizeBytes,
          completedAt: new Date(),
          errorMessage: null,
        },
      });

      await this._notifyExportCompleted(userId, completed);

      return this.toDto(completed);
    } catch (error) {
      const failed = await this.prisma.dataExportRequest.update({
        where: { id: processing.id },
        data: {
          status: 'failed',
          errorMessage: this.errorMessage(error),
        },
      });

      return this.toDto(failed);
    }
  }

  private async _buildPdfForKind(
    kind: string,
    language: string,
    report: ReportDashboardDataDto,
  ): Promise<Buffer> {
    switch (kind) {
      case 'monthly':
        return this.reportExportPdfService.buildMonthlyPdf({
          locale: language,
          report,
        });
      case 'print':
        return this.reportExportPdfService.buildPrintPdf({
          locale: language,
          report,
        });
      default:
        return this.reportExportPdfService.buildHospitalPdf({
          locale: language,
          report,
        });
    }
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

  private createFileName(
    kind: CreateDataExportRequestDto['kind'],
    range: CreateDataExportRequestDto['range'],
  ): string {
    const date = formatDateOnly(new Date());
    return `lumos-${kind ?? 'hospital'}-${range ?? DEFAULT_EXPORT_RANGE}-${date}.pdf`;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return 'Failed to generate report export';
  }

  private async _notifyExportCompleted(
    userId: string,
    row: Prisma.DataExportRequestGetPayload<{
      select: typeof dataExportSelect;
    }>,
  ): Promise<void> {
    try {
      const kindLabels: Record<string, string> = {
        hospital: '校医院报告',
        monthly: '月度报告',
        print: '打印预览报告',
      };
      await this.notificationsService.create(userId, {
        type: 'report_generated',
        title: `${kindLabels[row.kind] ?? '报告'}导出成功`,
        content: `您的${kindLabels[row.kind] ?? '报告'}已生成，可以前往报告页查看。`,
        action: 'report',
      });
    } catch {
      // Silently fail so notification issues do not break export flow.
    }
  }
}
