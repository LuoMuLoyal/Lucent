import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { Queue, Job } from 'bullmq';
import { BullmqQueueFactory } from '../../../common/queue/queue.factory';
import { TodayAnalysisService } from './analysis.service';
import type { TodayAnalysisDataDto, GenerateTodayAnalysisDto } from '../dto';

interface AnalysisJobData {
  userId: string;
  dto: GenerateTodayAnalysisDto;
  language: string;
}

interface AnalysisJobResult {
  status: 'completed' | 'failed';
  result?: TodayAnalysisDataDto;
  error?: string;
}

const QUEUE_NAME = 'today-analysis';
const JOB_NAME = 'generate';
const RESULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * BullMQ queue for async Today Analysis generation.
 *
 * When Redis is available, `enqueue()` adds a job to the queue and the worker
 * processes it in the background. The result is stored in the cache so the
 * client can poll `getStatus()`.
 *
 * When Redis is not available, `isConfigured` is false and callers should
 * fall back to the synchronous `TodayAnalysisService.generate()` method.
 */
@Injectable()
export class TodayAnalysisQueueService {
  private readonly logger = new Logger(TodayAnalysisQueueService.name);
  private readonly queue: Queue<AnalysisJobData, AnalysisJobResult> | null;

  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly analysisService: TodayAnalysisService,
  ) {
    const handle = factory.createQueue<AnalysisJobData, AnalysisJobResult>({
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
    dto: GenerateTodayAnalysisDto,
    language: string,
  ): Promise<string | null> {
    if (!this.queue) {
      return null;
    }

    const job = await this.queue.add(JOB_NAME, { userId, dto, language });
    return job.id ?? null;
  }

  async getStatus(jobId: string): Promise<{
    status: 'pending' | 'completed' | 'failed';
    result?: TodayAnalysisDataDto;
    error?: string;
  } | null> {
    // Check cache first (fast path for completed jobs)
    const cached = await this.cache.get<AnalysisJobResult>(
      this.resultKey(jobId),
    );
    if (cached != null) {
      return {
        status: cached.status,
        ...(cached.result != null ? { result: cached.result } : {}),
        ...(cached.error != null ? { error: cached.error } : {}),
      };
    }

    // Check BullMQ job state
    if (!this.queue) {
      return null;
    }

    const job = (await this.queue.getJob(jobId)) as Job<
      AnalysisJobData,
      AnalysisJobResult
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
    data: AnalysisJobData;
  }): Promise<AnalysisJobResult> {
    try {
      const result = await this.analysisService.generate(
        job.data.userId,
        job.data.dto,
        job.data.language,
      );
      const jobResult: AnalysisJobResult = { status: 'completed', result };
      if (job.id != null) {
        await this.cache.set(this.resultKey(job.id), jobResult, RESULT_TTL_MS);
      }
      return jobResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Today analysis job failed: ${message}`);
      const jobResult: AnalysisJobResult = { status: 'failed', error: message };
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
