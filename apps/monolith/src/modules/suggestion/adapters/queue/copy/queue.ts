import { Inject, Injectable, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { BullmqQueueFactory } from '../../../../../common/queue/queue.factory.js';
import { QUEUE_NAMES } from '../../../../../common/queue/queue-names.js';
import { RuntimeConfigService } from '../../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../../config/runtime/runtime-config.types.js';
import { BaseAsyncQueueService } from '../../../../../common/index.js';
import { SuggestionCopyService, type CopyGenerationResult } from './writer.js';
import type { CopyJobData } from '../../../types/copy-generation.types.js';

const QUEUE_NAME = QUEUE_NAMES.suggestionCopyGeneration;
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
  private readonly copyService: SuggestionCopyService;

  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) cache: Cache,
    @Inject(SuggestionCopyService) copyService: SuggestionCopyService,
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
          (data) => this.copyService.generateViaLlm(data),
          'Suggestion copy generation job failed',
        ),
      runtimeConfig,
    );
    this.copyService = copyService;
  }

  async enqueue(data: CopyJobData): Promise<string | null> {
    if (!this.queue) {
      return null;
    }
    const job = await this.queue.add(JOB_NAME, data);
    return job.id ?? null;
  }
}
