import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { ReportsService } from '../../reports/dashboard';
import { DataExportStorageService } from './storage.service';
import { ReportExportPdfService } from './report-pdf/pdf.service';
import { formatDateOnly, now } from '../../../common/helpers';
import { extractErrorInfo } from '../../../common/helpers';

export interface DataExportProcessorInput {
  exportRequestId: string;
  userId: string;
  language: string;
}

/**
 * Processes report PDF generation requests.
 *
 * Despite the class name, this service does NOT export raw user data. It
 * calls `ReportsService.getDashboard` to obtain aggregated report data,
 * renders it as a PDF, and uploads to object storage.
 *
 * (Architecture review #14 — naming boundary documented.)
 */
@Injectable()
export class DataExportProcessorService {
  private readonly logger = new Logger(DataExportProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
    private readonly storageService: DataExportStorageService,
    private readonly reportExportPdfService: ReportExportPdfService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async process(input: DataExportProcessorInput): Promise<void> {
    const { exportRequestId, userId, language } = input;

    const request = await this.prisma.dataExportRequest.findUnique({
      where: { id: exportRequestId },
    });

    if (!request) {
      this.logger.warn(`Export request ${exportRequestId} not found`);
      return;
    }

    await this.prisma.dataExportRequest.update({
      where: { id: exportRequestId },
      data: { status: 'processing', errorMessage: null },
    });

    try {
      const report = await this.reportsService.getDashboard(
        userId,
        { range: request.range as 'last_7_days' | 'last_30_days' },
        language,
      );

      const pdf = await this.buildPdfForKind(request.kind, language, report);
      const fileName = this.createFileName(request.kind, request.range);

      const uploaded = await this.storageService.uploadPdf({
        userId,
        fileName,
        body: pdf,
      });

      await this.prisma.dataExportRequest.update({
        where: { id: exportRequestId },
        data: {
          status: 'completed',
          objectKey: uploaded.objectKey,
          bucket: uploaded.bucket,
          provider: uploaded.provider,
          fileName,
          fileSizeBytes: uploaded.fileSizeBytes,
          completedAt: now(),
          errorMessage: null,
        },
      });

      await this.notifyExportCompleted(userId, request.kind);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Failed to generate report export';

      this.logger.error(
        `Export processing failed for ${exportRequestId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.prisma.dataExportRequest.update({
        where: { id: exportRequestId },
        data: { status: 'failed', errorMessage: message },
      });

      throw error;
    }
  }

  private async buildPdfForKind(
    kind: string,
    language: string,
    report: Awaited<ReturnType<ReportsService['getDashboard']>>,
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

  private createFileName(kind: string, range: string): string {
    const date = formatDateOnly(now());
    return `lumos-${kind}-${range}-${date}.pdf`;
  }

  private async notifyExportCompleted(
    userId: string,
    kind: string,
  ): Promise<void> {
    try {
      const kindLabels: Record<string, string> = {
        hospital: '校医院报告',
        monthly: '月度报告',
        print: '打印预览报告',
      };
      await this.notificationsService.create(userId, {
        type: 'report_generated',
        title: `${kindLabels[kind] ?? '报告'}导出成功`,
        content: `您的${kindLabels[kind] ?? '报告'}已生成，可以前往报告页查看。`,
        action: 'report',
      });
    } catch (error: unknown) {
      const { message: reason } = extractErrorInfo(error);
      this.logger.warn(
        `Failed to notify export completed for user ${userId}, kind ${kind}: ${reason}`,
      );
    }
  }
}
