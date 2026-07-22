import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
import { BaseAsyncQueueService } from '../../../../common/queue';
import {
  SuggestionCopyService,
  type CopyGenerationResult,
} from './copy.service';
import type { CopyJobData } from '../../types';

const QUEUE_NAME = 'suggestion-copy-generation';
const JOB_NAME = 'generate-copy';

/**
 * BullMQ queue for async suggestion copy generation.
 *
 * When Redis is available, `enqueue()` adds a job to the queue and the worker
 * processes it in the background. The result is stored in the copy cache.
 *
 * When Redis is not available, `isConfigured` is false and callers should
 * fall back to the synchronous `SuggestionCopyService.generateSync()` method.
 *
 * This mirrors the ExplanationQueueService pattern exactly.
 */
@Injectable()
export class SuggestionCopyQueueService extends BaseAsyncQueueService<
  CopyJobData,
  CopyGenerationResult
> {
  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) cache: Cache,
    private readonly copyService: SuggestionCopyService,
  ) {
    super(QUEUE_NAME, factory, cache, 3, async (job) =>
      this.processJob(
        job,
        (data) => this.copyService.generateViaLlm(data),
        'Suggestion copy generation job failed',
      ),
    );
  }

  async enqueue(data: CopyJobData): Promise<string | null> {
    if (!this.queue) {
      return null;
    }
    const job = await this.queue.add(JOB_NAME, data);
    return job.id ?? null;
  }
}
