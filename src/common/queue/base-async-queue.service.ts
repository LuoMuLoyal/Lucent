import { Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import type { Queue, Job } from 'bullmq';
import { BullmqQueueFactory } from './queue.factory';

/** Default TTL for cached job results (30 minutes). */
export const DEFAULT_RESULT_TTL_MS = 30 * 60 * 1000;

/**
 * Shared interface for async job results stored in cache.
 * All queue services produce results that conform to this shape.
 */
export interface AsyncJobResult<T> {
  status: 'completed' | 'failed';
  result?: T;
  error?: string;
}

/**
 * Configuration passed to {@link BaseAsyncQueueService} by subclasses.
 */
export interface QueueConfig<TData, TResult> {
  name: string;
  jobName: string;
  workerConcurrency: number;
  processor: (job: {
    id: string | undefined;
    name: string;
    data: TData;
  }) => Promise<AsyncJobResult<TResult>>;
}

/**
 * Abstract base class for BullMQ-backed async queue services.
 *
 * Encapsulates the common patterns shared by all 6 async queue services:
 * - Queue creation and lifecycle
 * - `isConfigured` getter
 * - `resultKey` generation
 * - Result caching with TTL
 * - `getStatus` polling (cache → job state)
 * - `processJob` try-catch-cache wrapper
 *
 * Subclasses only need to:
 * - Provide queue config (name, concurrency)
 * - Implement `executeJob(data)` (the actual business logic)
 * - Implement their own `enqueue` method (parameters vary per service)
 */
export abstract class BaseAsyncQueueService<TData, TResult> {
  protected readonly logger: Logger;
  protected readonly queue: Queue<TData, AsyncJobResult<TResult>> | null;

  constructor(
    private readonly queueName: string,
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) protected readonly cache: Cache,
    concurrency: number,
    processor: (job: {
      id: string | undefined;
      data: TData;
    }) => Promise<AsyncJobResult<TResult>>,
  ) {
    this.logger = new Logger(this.constructor.name);
    const handle = factory.createQueue<TData, AsyncJobResult<TResult>>({
      name: queueName,
      workerConcurrency: concurrency,
      processor,
    });
    this.queue = handle.queue;
  }

  get isConfigured(): boolean {
    return this.queue != null;
  }

  protected resultKey(jobId: string): string {
    return `async-job:${this.queueName}:${jobId}`;
  }

  /**
   * Store a job result in cache.
   */
  protected async storeResult(
    jobId: string,
    result: AsyncJobResult<TResult>,
    ttlMs: number = DEFAULT_RESULT_TTL_MS,
  ): Promise<void> {
    await this.cache.set(this.resultKey(jobId), result, ttlMs);
  }

  /**
   * Poll job status. Checks cache first, then falls back to BullMQ job state.
   *
   * @param jobId   The job ID to poll.
   * @param userId  Optional. If provided, the job's `userId` field is checked
   *                for ownership before returning results (IDOR protection).
   */
  protected async pollStatus(
    jobId: string,
    userId?: string,
  ): Promise<{
    status: 'pending' | 'completed' | 'failed';
    result?: TResult;
    error?: string;
  } | null> {
    // Fast path: check cache for completed/failed result
    const cached = await this.cache.get<AsyncJobResult<TResult>>(
      this.resultKey(jobId),
    );
    if (cached != null) {
      if (userId != null) {
        // Verify ownership via job data before returning cached result
        if (!this.queue) {
          return null;
        }
        const job = (await this.queue.getJob(jobId)) as Job<
          TData,
          AsyncJobResult<TResult>
        > | null;
        if (job == null) {
          return null;
        }
        if ((job.data as { userId?: string }).userId !== userId) {
          this.logger.debug(
            `pollStatus: job ${jobId} exists but userId mismatch`,
          );
          return null;
        }
      }
      return {
        status: cached.status,
        ...(cached.result != null ? { result: cached.result } : {}),
        ...(cached.error != null ? { error: cached.error } : {}),
      };
    }

    // Slow path: check BullMQ job state
    if (!this.queue) {
      return null;
    }

    const job = (await this.queue.getJob(jobId)) as Job<
      TData,
      AsyncJobResult<TResult>
    > | null;
    if (job == null) {
      return null;
    }

    // Ownership check for jobs that carry a userId
    if (userId != null && (job.data as { userId?: string }).userId !== userId) {
      this.logger.debug(`pollStatus: job ${jobId} exists but userId mismatch`);
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

  /**
   * Wrapper around the subclass-provided execution logic.
   * Handles try-catch, result caching, and error logging.
   */
  protected async processJob(
    job: { id: string | undefined; data: TData },
    execute: (data: TData) => Promise<TResult>,
    errorLabel: string,
  ): Promise<AsyncJobResult<TResult>> {
    try {
      const result = await execute(job.data);
      const jobResult: AsyncJobResult<TResult> = {
        status: 'completed',
        result,
      };
      if (job.id != null) {
        await this.storeResult(job.id, jobResult);
      }
      return jobResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${errorLabel}: ${message}`,
        error instanceof Error ? error.stack : undefined,
        {
          queue: this.queueName,
          jobId: job.id,
          errorLabel,
          errorMessage: message,
        },
      );
      const jobResult: AsyncJobResult<TResult> = {
        status: 'failed',
        error: message,
      };
      if (job.id != null) {
        await this.storeResult(job.id, jobResult);
      }
      return jobResult;
    }
  }
}
