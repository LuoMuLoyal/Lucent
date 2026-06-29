import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConnectionOptions, Job } from 'bullmq';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ReportsService } from '../../reports/dashboard/reports.service';
import { DataExportStorageService } from './data-export-storage.service';
import { ReportExportPdfService } from './report-export-pdf.service';
import { formatDateOnly } from '../../../common/utils/date-time.utils';

interface DataExportJobData {
  exportRequestId: string;
  userId: string;
  language: string;
}

const QUEUE_NAME = 'data-export';

@Injectable()
export class DataExportQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataExportQueueService.name);
  private queue: Queue<DataExportJobData> | null = null;
  private worker: Worker<DataExportJobData> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportsService: ReportsService,
    private readonly storageService: DataExportStorageService,
    private readonly reportExportPdfService: ReportExportPdfService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit() {
    const redisUrl = process.env['REDIS_URL'];
    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL is not configured; data export queue is disabled',
      );
      return;
    }

    const connection: ConnectionOptions = { url: redisUrl };

    this.queue = new Queue<DataExportJobData>(QUEUE_NAME, { connection });

    this.worker = new Worker<DataExportJobData>(
      QUEUE_NAME,
      async (job: Job<DataExportJobData>) => {
        await this.processJob(job.data);
      },
      {
        connection: { ...connection, maxRetriesPerRequest: null },
        concurrency: 1,
        autorun: true,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Export job ${job?.id ?? 'unknown'} failed: ${err.message}`,
      );
    });

    this.logger.log('Data export queue initialized');
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  get isConfigured(): boolean {
    return this.queue != null;
  }

  async enqueue(data: DataExportJobData): Promise<void> {
    if (!this.queue) {
      throw new Error('Data export queue is not configured');
    }

    await this.queue.add('export', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }

  private async processJob(data: DataExportJobData): Promise<void> {
    const { exportRequestId, userId, language } = data;

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
      const effectiveRange = request.range;
      const kind = request.kind;

      const report = await this.reportsService.getDashboard(
        userId,
        { range: effectiveRange as 'last_7_days' | 'last_30_days' },
        language,
      );

      const pdf = await this.buildPdfForKind(kind, language, report);
      const fileName = this.createFileName(kind, effectiveRange);

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
          completedAt: new Date(),
          errorMessage: null,
        },
      });

      await this.notifyExportCompleted(userId, request.kind);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Failed to generate report export';

      await this.prisma.dataExportRequest.update({
        where: { id: exportRequestId },
        data: { status: 'failed', errorMessage: message },
      });

      throw error; // Re-throw so BullMQ can retry
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
    const date = formatDateOnly(new Date());
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
    } catch {
      // Silently fail
    }
  }
}
