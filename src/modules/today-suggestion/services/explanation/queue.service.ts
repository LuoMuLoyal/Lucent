import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { Queue, Job } from 'bullmq';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
import { ExplanationService, type ExplanationResult } from './service';

interface ExplanationJobData {
  userId: string;
  suggestionId: string;
  language?: string;
}

interface ExplanationJobResult {
  status: 'completed' | 'failed';
  result?: ExplanationResult;
  error?: string;
}

const QUEUE_NAME = 'suggestion-explanation';
const JOB_NAME = 'explain';
const RESULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * BullMQ queue for async Suggestion AI explanation.
 *
 * When Redis is available, `enqueue()` adds a job to the queue and the worker
 * processes it in the background. The result is stored in the cache so the
 * client can poll `getStatus()`.
 *
 * When Redis is not available, `isConfigured` is false and callers should
 * fall back to the synchronous `ExplanationService.explain()` method.
 */
@Injectable()
export class ExplanationQueueService {
  private readonly logger = new Logger(ExplanationQueueService.name);
  private readonly queue: Queue<
    ExplanationJobData,
    ExplanationJobResult
  > | null;

  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly explanationService: ExplanationService,
  ) {
    const handle = factory.createQueue<
      ExplanationJobData,
      ExplanationJobResult
    >({
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
    suggestionId: string,
    language?: string,
  ): Promise<string | null> {
    if (!this.queue) {
      return null;
    }

    const job = await this.queue.add(JOB_NAME, {
      userId,
      suggestionId,
      ...(language != null ? { language } : {}),
    });
    return job.id ?? null;
  }

  async getStatus(jobId: string): Promise<{
    status: 'pending' | 'completed' | 'failed';
    result?: ExplanationResult;
    error?: string;
  } | null> {
    const cached = await this.cache.get<ExplanationJobResult>(
      this.resultKey(jobId),
    );
    if (cached != null) {
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
      ExplanationJobData,
      ExplanationJobResult
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
    data: ExplanationJobData;
  }): Promise<ExplanationJobResult> {
    try {
      const result = await this.explanationService.explain(
        job.data.userId,
        job.data.suggestionId,
        job.data.language,
      );
      const jobResult: ExplanationJobResult = { status: 'completed', result };
      if (job.id != null) {
        await this.cache.set(this.resultKey(job.id), jobResult, RESULT_TTL_MS);
      }
      return jobResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Suggestion explanation job failed: ${message}`);
      const jobResult: ExplanationJobResult = {
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
