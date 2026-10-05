import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../../../prisma/index.js';
import { INotificationSender } from '../../notifications/index.js';
import { ReportsService } from '../../reports/index.js';
import { DataExportStorageService } from './storage.service.js';
import { ReportExportPdfService } from './report-pdf/pdf.service.js';
import { formatDateOnly, now, resolveLocale } from '../../../common/index.js';
import { extractErrorInfo } from '../../../common/index.js';
import { unwrapResult } from '../../../common/result/index.js';

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
    private readonly notificationsService: INotificationSender,
    private readonly i18n: I18nService,
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

      // `uploadPdf` returns ResultAsync — a storage dependency failure (Err)
      // is folded into the same failure path as a rejection: the request is
      // marked failed and the error rethrown for BullMQ retry.
      const uploaded = await unwrapResult(
        this.storageService.uploadPdf({
          userId,
          fileName,
          body: pdf,
        }),
      );

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

      await this.notifyExportCompleted(userId, request.kind, language);
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

      // eslint-disable-next-line error-handling/no-bare-throw-error -- BullMQ worker re-throw to mark job failed
      throw new Error(
        `Export processing failed for request ${exportRequestId}`,
      );
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

  /**
   * Notifies the user that an export finished.
   *
   * The copy is persisted with the notification, so it is rendered here in the
   * language the export was requested in (carried through the queue job —
   * this is a worker, so there is no request context). The kind names and the
   * title/body come from the `notifications` dictionary; the previous
   * hardcoded Chinese meant an English-locale user got a Chinese notice for an
   * English export.
   */
  private async notifyExportCompleted(
    userId: string,
    kind: string,
    language: string,
  ): Promise<void> {
    try {
      const lang = resolveLocale(language);
      // Unknown kinds keep a generic label rather than the raw kind id.
      const kindLabelKey = EXPORT_KIND_LABEL_KEYS[kind];
      const kindLabel = this.i18n.t(
        kindLabelKey ?? 'notifications.report_kind_default',
        { lang },
      );

      await unwrapResult(
        this.notificationsService.create(userId, {
          type: 'report_generated',
          title: this.i18n.t('notifications.report_generated_title', {
            lang,
            args: { kind: kindLabel },
          }),
          content: this.i18n.t('notifications.report_generated_content', {
            lang,
            args: { kind: kindLabel },
          }),
          action: 'report',
        }),
      );
    } catch (error: unknown) {
      const { message: reason } = extractErrorInfo(error);
      this.logger.warn(
        `Failed to notify export completed for user ${userId}, kind ${kind}: ${reason}`,
      );
    }
  }
}

/** Maps an export kind to its `notifications.report_kind_*` i18n key. */
const EXPORT_KIND_LABEL_KEYS: Record<string, string> = {
  hospital: 'notifications.report_kind_hospital',
  monthly: 'notifications.report_kind_monthly',
  print: 'notifications.report_kind_print',
};
