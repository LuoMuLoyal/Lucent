import { Injectable } from '@nestjs/common';
import type { DataExportRequest } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from '../reports/dashboard/reports.service';
import {
  type CreateDataExportRequestDto,
  type DataExportRequestDataDto,
} from './dto';
import { DataExportStorageService } from './data-export-storage.service';
import { ReportExportPdfService } from './report-export-pdf.service';
import type { ReportDashboardDataDto } from '../reports/dto';

const DEFAULT_EXPORT_RANGE = 'last_7_days';
const MONTHLY_EXPORT_RANGE = 'last_30_days';

@Injectable()
export class DataExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
    private readonly storageService: DataExportStorageService,
    private readonly reportExportPdfService: ReportExportPdfService,
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

    const created = await this.prisma.dataExportRequest.create({
      data: {
        userId,
        kind,
        format,
        range: effectiveRange,
        status: 'requested',
      },
    });

    if (!this.storageService.isConfigured()) {
      const unavailable = await this.prisma.dataExportRequest.update({
        where: { id: created.id },
        data: {
          status: 'unavailable',
          errorMessage: 'Tencent COS export storage is not configured',
        },
      });

      return this.toDto(unavailable);
    }

    const processing = await this.prisma.dataExportRequest.update({
      where: { id: created.id },
      data: {
        status: 'processing',
        errorMessage: null,
      },
    });

    try {
      const report = await this.reportsService.getDashboard(
        userId,
        { range: effectiveRange },
        language,
      );
      const pdf = await this._buildPdfForKind(kind, language, report);
      const fileName = this.createFileName(kind, effectiveRange);
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
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return row ? this.toDto(row) : null;
  }

  private toDto(row: DataExportRequest): DataExportRequestDataDto {
    return {
      id: row.id,
      kind: row.kind as DataExportRequestDataDto['kind'],
      format: row.format as DataExportRequestDataDto['format'],
      range: row.range as DataExportRequestDataDto['range'],
      status: row.status as DataExportRequestDataDto['status'],
      requestedAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      downloadUrl:
        row.downloadUrl ?? this.storageService.createDownloadUrl(row.objectKey),
      fileName: row.fileName,
      fileSizeBytes: row.fileSizeBytes,
      errorMessage: row.errorMessage,
    };
  }

  private createFileName(
    kind: CreateDataExportRequestDto['kind'],
    range: CreateDataExportRequestDto['range'],
  ): string {
    const date = new Date().toISOString().slice(0, 10);
    return `lumos-${kind ?? 'hospital'}-${range ?? DEFAULT_EXPORT_RANGE}-${date}.pdf`;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return 'Failed to generate report export';
  }
}
