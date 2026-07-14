import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { BullmqQueueFactory } from '../../../common/queue/queue.factory';
import { BaseAsyncQueueService } from '../../../common/queues/base-async-queue.service';
import { TodayAnalysisService } from './analysis.service';
import type { TodayAnalysisDataDto, GenerateTodayAnalysisDto } from '../dto';

interface AnalysisJobData {
  userId: string;
  dto: GenerateTodayAnalysisDto;
  language: string;
}

const QUEUE_NAME = 'today-analysis';
const JOB_NAME = 'generate';

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
export class TodayAnalysisQueueService extends BaseAsyncQueueService<
  AnalysisJobData,
  TodayAnalysisDataDto
> {
  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) cache: Cache,
    private readonly analysisService: TodayAnalysisService,
  ) {
    super(QUEUE_NAME, factory, cache, 2, async (job) =>
      this.processJob(
        job,
        (data) =>
          this.analysisService.generate(data.userId, data.dto, data.language),
        'Today analysis job failed',
      ),
    );
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

  async getStatus(jobId: string) {
    return this.pollStatus(jobId);
  }
}
