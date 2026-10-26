import { Inject, Injectable, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { QUEUE_NAMES } from '../../../../common/queue/queue-names.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import { BaseAsyncQueueService } from '../../../../common/index.js';
import {
  CLINIC_SUMMARY_PDF,
  type ClinicSummaryPdf,
} from '../../application/ports/clinic-summary-pdf.js';

interface PdfExportJobData {
  userId: string;
  locale: string;
}

export interface PdfExportResult {
  /** Base64-encoded PDF buffer. */
  pdfBase64?: string;
}

const QUEUE_NAME = QUEUE_NAMES.clinicSummaryPdf;
const JOB_NAME = 'export';

/**
 * BullMQ queue for async Clinic Summary PDF export.
 *
 * When Redis is available, `enqueue()` adds a job to the queue and the worker
 * generates the PDF in the background. The result (base64-encoded PDF) is
 * stored in the cache so the client can poll `getStatus()`.
 *
 * When Redis is not available, `isConfigured` is false and callers should
 * fall back to the synchronous `ClinicSummaryPdfService.exportPdf()` method.
 */
@Injectable()
export class ClinicSummaryPdfQueueService extends BaseAsyncQueueService<
  PdfExportJobData,
  PdfExportResult
> {
  private readonly clinicSummaryPdfService: ClinicSummaryPdf;

  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) cache: Cache,
    @Inject(CLINIC_SUMMARY_PDF)
    clinicSummaryPdfService: ClinicSummaryPdf,
    @Optional()
    @Inject(RuntimeConfigService)
    runtimeConfig?: RuntimeConfigPort,
  ) {
    super(
      QUEUE_NAME,
      factory,
      cache,
      async (job) =>
        this.processJob(
          job,
          async (data) => ({
            pdfBase64: (
              await this.clinicSummaryPdfService.exportPdf(
                data.userId,
                data.locale,
              )
            ).toString('base64'),
          }),
          'Clinic summary PDF export job failed',
        ),
      runtimeConfig,
    );
    this.clinicSummaryPdfService = clinicSummaryPdfService;
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
