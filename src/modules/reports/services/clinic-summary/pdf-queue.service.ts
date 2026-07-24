import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
import { BaseAsyncQueueService } from '../../../../common';
import { ClinicSummaryService } from './summary.service';

interface PdfExportJobData {
  userId: string;
  locale: string;
}

export interface PdfExportResult {
  /** Base64-encoded PDF buffer. */
  pdfBase64?: string;
}

const QUEUE_NAME = 'clinic-summary-pdf';
const JOB_NAME = 'export';

/**
 * BullMQ queue for async Clinic Summary PDF export.
 *
 * When Redis is available, `enqueue()` adds a job to the queue and the worker
 * generates the PDF in the background. The result (base64-encoded PDF) is
 * stored in the cache so the client can poll `getStatus()`.
 *
 * When Redis is not available, `isConfigured` is false and callers should
 * fall back to the synchronous `ClinicSummaryService.exportPdf()` method.
 */
@Injectable()
export class ClinicSummaryPdfQueueService extends BaseAsyncQueueService<
  PdfExportJobData,
  PdfExportResult
> {
  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) cache: Cache,
    private readonly clinicSummaryService: ClinicSummaryService,
  ) {
    super(QUEUE_NAME, factory, cache, 1, async (job) =>
      this.processJob(
        job,
        async (data) => ({
          pdfBase64: (
            await this.clinicSummaryService.exportPdf(data.userId, data.locale)
          ).toString('base64'),
        }),
        'Clinic summary PDF export job failed',
      ),
    );
  }

  async enqueue(userId: string, locale: string): Promise<string | null> {
    if (!this.queue) {
      return null;
    }
    const job = await this.queue.add(JOB_NAME, { userId, locale });
    return job.id ?? null;
  }

  async getStatus(jobId: string, userId: string) {
    return this.pollStatus(jobId, userId);
  }
}
