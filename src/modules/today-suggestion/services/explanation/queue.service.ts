import { Inject, Injectable, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { QUEUE_NAMES } from '../../../../common/queue/queue-names.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import { BaseAsyncQueueService } from '../../../../common/index.js';
import { unwrapResult } from '../../../../common/result/index.js';
import {
  ExplanationService,
  type ExplanationResult,
} from './explainer.service.js';

interface ExplanationJobData {
  userId: string;
  suggestionId: string;
  language?: string;
}

const QUEUE_NAME = QUEUE_NAMES.suggestionExplanation;
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
          (data) =>
            unwrapResult(
              this.explanationService.explain(
                data.userId,
                data.suggestionId,
                data.language,
              ),
            ),
          'Suggestion explanation job failed',
        ),
      runtimeConfig,
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
