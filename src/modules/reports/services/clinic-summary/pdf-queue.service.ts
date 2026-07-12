import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { Queue, Job } from 'bullmq';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
import { ClinicSummaryService } from './summary.service';

interface PdfExportJobData {
  userId: string;
  locale: string;
}

interface PdfExportJobResult {
  status: 'completed' | 'failed';
  /** Base64-encoded PDF buffer. */
  pdfBase64?: string;
  error?: string;
}

const QUEUE_NAME = 'clinic-summary-pdf';
const JOB_NAME = 'export';
const RESULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

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
export class ClinicSummaryPdfQueueService {
  private readonly logger = new Logger(ClinicSummaryPdfQueueService.name);
  private readonly queue: Queue<PdfExportJobData, PdfExportJobResult> | null;

  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly clinicSummaryService: ClinicSummaryService,
  ) {
    const handle = factory.createQueue<PdfExportJobData, PdfExportJobResult>({
      name: QUEUE_NAME,
      workerConcurrency: 1,
      processor: async (job) => {
        return this.processJob(job);
      },
    });
    this.queue = handle.queue;
  }

  get isConfigured(): boolean {
    return this.queue != null;
  }

  async enqueue(userId: string, locale: string): Promise<string | null> {
    if (!this.queue) {
      return null;
    }

    const job = await this.queue.add(JOB_NAME, { userId, locale });
    return job.id ?? null;
  }

  async getStatus(jobId: string): Promise<{
    status: 'pending' | 'completed' | 'failed';
    pdfBase64?: string;
    error?: string;
  } | null> {
    const cached = await this.cache.get<PdfExportJobResult>(
      this.resultKey(jobId),
    );
    if (cached != null) {
      return {
        status: cached.status,
        ...(cached.pdfBase64 != null ? { pdfBase64: cached.pdfBase64 } : {}),
        ...(cached.error != null ? { error: cached.error } : {}),
      };
    }

    if (!this.queue) {
      return null;
    }

    const job = (await this.queue.getJob(jobId)) as Job<
      PdfExportJobData,
      PdfExportJobResult
    > | null;
    if (job == null) {
      return null;
    }

    const state = await job.getState();
    if (state === 'completed') {
      const result = job.returnvalue;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- returnvalue may be undefined at runtime
      if (result != null) {
        return {
          status: result.status,
          ...(result.pdfBase64 != null ? { pdfBase64: result.pdfBase64 } : {}),
          ...(result.error != null ? { error: result.error } : {}),
        };
      }
      return { status: 'completed' };
    }

    if (state === 'failed') {
      return {
        status: 'failed',
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- failedReason may be undefined at runtime
        error: job.failedReason ?? 'Unknown error',
      };
    }

    return { status: 'pending' };
  }

  private async processJob(job: {
    id: string | undefined;
    data: PdfExportJobData;
  }): Promise<PdfExportJobResult> {
    try {
      const pdf = await this.clinicSummaryService.exportPdf(
        job.data.userId,
        job.data.locale,
      );
      const jobResult: PdfExportJobResult = {
        status: 'completed',
        pdfBase64: pdf.toString('base64'),
      };
      if (job.id != null) {
        await this.cache.set(this.resultKey(job.id), jobResult, RESULT_TTL_MS);
      }
      return jobResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Clinic summary PDF export job failed: ${message}`);
      const jobResult: PdfExportJobResult = {
        status: 'failed',
        error: message,
      };
      if (job.id != null) {
        await this.cache.set(this.resultKey(job.id), jobResult, RESULT_TTL_MS);
      }
      return jobResult;
    }
  }

  private resultKey(jobId: string): string {
    return `async-job:${QUEUE_NAME}:${jobId}`;
  }
}
