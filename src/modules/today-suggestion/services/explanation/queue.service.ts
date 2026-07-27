import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
import { BaseAsyncQueueService } from '../../../../common';
import { ExplanationService, type ExplanationResult } from './service';

interface ExplanationJobData {
  userId: string;
  suggestionId: string;
  language?: string;
}

const QUEUE_NAME = 'suggestion-explanation';
const JOB_NAME = 'explain';

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
export class ExplanationQueueService extends BaseAsyncQueueService<
  ExplanationJobData,
  ExplanationResult
> {
  private readonly explanationService: ExplanationService;

  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) cache: Cache,
    @Inject(ExplanationService) explanationService: ExplanationService,
  ) {
    super(QUEUE_NAME, factory, cache, 2, async (job) =>
      this.processJob(
        job,
        (data) =>
          this.explanationService.explain(
            data.userId,
            data.suggestionId,
            data.language,
          ),
        'Suggestion explanation job failed',
      ),
    );
    this.explanationService = explanationService;
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

  async getStatus(jobId: string, userId: string) {
    return this.pollStatus(jobId, userId);
  }
}
