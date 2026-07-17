import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
import { BaseAsyncQueueService } from '../../../../common/queue';
import type { GenerateReportSummaryDto, ReportSummaryDataDto } from '../../dto';
import { ReportsAiSummaryService } from './summary.service';

interface SummaryJobData {
  userId: string;
  dto: GenerateReportSummaryDto;
  language: string;
}

const QUEUE_NAME = 'report-summary';
const JOB_NAME = 'generate';

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
export class ReportSummaryQueueService extends BaseAsyncQueueService<
  SummaryJobData,
  ReportSummaryDataDto
> {
  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) cache: Cache,
    private readonly summaryService: ReportsAiSummaryService,
  ) {
    super(QUEUE_NAME, factory, cache, 2, async (job) =>
      this.processJob(
        job,
        (data) =>
          this.summaryService.generate(data.userId, data.dto, data.language),
        'Report summary job failed',
      ),
    );
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

  async getStatus(jobId: string, userId: string) {
    return this.pollStatus(jobId, userId);
  }
}
