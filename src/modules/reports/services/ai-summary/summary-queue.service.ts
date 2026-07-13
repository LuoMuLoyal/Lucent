import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { Queue, Job } from 'bullmq';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
import type { GenerateReportSummaryDto, ReportSummaryDataDto } from '../../dto';
import { ReportsAiSummaryService } from './summary.service';

interface SummaryJobData {
  userId: string;
  dto: GenerateReportSummaryDto;
  language: string;
}

interface SummaryJobResult {
  status: 'completed' | 'failed';
  result?: ReportSummaryDataDto;
  error?: string;
}

const QUEUE_NAME = 'report-summary';
const JOB_NAME = 'generate';
const RESULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * BullMQ queue for async Report AI Summary generation.
 *
 * When Redis is available, `enqueue()` adds a job to the queue and the worker
 * processes it in the background. The result is stored in the cache so the
 * client can poll `getStatus()`.
 *
 * When Redis is not available, `isConfigured` is false and callers should
 * fall back to the synchronous `ReportsAiSummaryService.generate()` method.
 */
@Injectable()
export class ReportSummaryQueueService {
  private readonly logger = new Logger(ReportSummaryQueueService.name);
  private readonly queue: Queue<SummaryJobData, SummaryJobResult> | null;

  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly summaryService: ReportsAiSummaryService,
  ) {
    const handle = factory.createQueue<SummaryJobData, SummaryJobResult>({
      name: QUEUE_NAME,
      workerConcurrency: 2,
      processor: async (job) => {
        return this.processJob(job);
      },
    });
    this.queue = handle.queue;
  }

  get isConfigured(): boolean {
    return this.queue != null;
  }

  async enqueue(
    userId: string,
    dto: GenerateReportSummaryDto,
    language: string,
  ): Promise<string | null> {
    if (!this.queue) {
      return null;
    }

    const job = await this.queue.add(JOB_NAME, { userId, dto, language });
    return job.id ?? null;
  }

  async getStatus(
    jobId: string,
    userId: string,
  ): Promise<{
    status: 'pending' | 'completed' | 'failed';
    result?: ReportSummaryDataDto;
    error?: string;
  } | null> {
    const cached = await this.cache.get<SummaryJobResult>(
      this.resultKey(jobId),
    );
    if (cached != null) {
      // Verify ownership via job data before returning cached result.
      if (!this.queue) {
        return null;
      }
      const job = (await this.queue.getJob(jobId)) as Job<
        SummaryJobData,
        SummaryJobResult
      > | null;
      if (job == null || job.data.userId !== userId) {
        return null;
      }
      return {
        status: cached.status,
        ...(cached.result != null ? { result: cached.result } : {}),
        ...(cached.error != null ? { error: cached.error } : {}),
      };
    }

    if (!this.queue) {
      return null;
    }

    const job = (await this.queue.getJob(jobId)) as Job<
      SummaryJobData,
      SummaryJobResult
    > | null;
    if (job == null || job.data.userId !== userId) {
      return null;
    }

    const state = await job.getState();
    if (state === 'completed') {
      const result = job.returnvalue;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- returnvalue may be undefined at runtime
      if (result != null) {
        return {
          status: result.status,
          ...(result.result != null ? { result: result.result } : {}),
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
    data: SummaryJobData;
  }): Promise<SummaryJobResult> {
    try {
      const result = await this.summaryService.generate(
        job.data.userId,
        job.data.dto,
        job.data.language,
      );
      const jobResult: SummaryJobResult = { status: 'completed', result };
      if (job.id != null) {
        await this.cache.set(this.resultKey(job.id), jobResult, RESULT_TTL_MS);
      }
      return jobResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Report summary job failed: ${message}`);
      const jobResult: SummaryJobResult = { status: 'failed', error: message };
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
