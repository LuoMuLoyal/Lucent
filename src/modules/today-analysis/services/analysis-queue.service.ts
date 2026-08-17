import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { BullmqQueueFactory } from '../../../common/queue/queue.factory';
import { BaseAsyncQueueService } from '../../../common';
import { TodayAnalysisService } from './analysis.service';
import type {
  TodayAnalysisDataDto,
  TodayAnalysisReadDataDto,
} from '../dto/analysis-response.dto';

import type { GenerateTodayAnalysisDto } from '../dto/generate-today-analysis.dto';

export interface AnalysisJobData {
  userId: string;
  dto: GenerateTodayAnalysisDto;
  language: string;
  sourceVersion?: number;
  reasonCode?: string;
  triggerKey?: string;
}

export const TODAY_ANALYSIS_QUEUE_NAME = 'today-analysis';
export const TODAY_ANALYSIS_JOB_NAME = 'generate';

export function buildTodayAnalysisJobId(
  userId: string,
  date: string,
  sourceVersion: number,
): string {
  return `${TODAY_ANALYSIS_QUEUE_NAME}:${userId}:${date}:${String(sourceVersion)}`;
}

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
  TodayAnalysisDataDto | TodayAnalysisReadDataDto
> {
  private readonly analysisService: TodayAnalysisService;

  constructor(
    factory: BullmqQueueFactory,
    @Inject(CACHE_MANAGER) cache: Cache,
    @Inject(TodayAnalysisService) analysisService: TodayAnalysisService,
  ) {
    super(TODAY_ANALYSIS_QUEUE_NAME, factory, cache, 1, async (job) =>
      this.processJob(
        job,
        (data) =>
          data.sourceVersion == null
            ? this.analysisService.generate(
                data.userId,
                data.dto,
                data.language,
              )
            : this.analysisService.generateForVersion(
                data.userId,
                data.dto,
                data.language,
                data.sourceVersion,
              ),
        'Today analysis job failed',
      ),
    );
    this.analysisService = analysisService;
  }

  async enqueue(
    userId: string,
    dto: GenerateTodayAnalysisDto,
    language: string,
    sourceVersion?: number,
    reasonCode?: string,
    triggerKey?: string,
  ): Promise<string | null> {
    if (!this.queue) {
      return null;
    }
    const date = await this.analysisService.resolveDate(userId, dto.date);
    const resolvedDto: GenerateTodayAnalysisDto =
      dto.date == null ? { date } : dto;
    const data: AnalysisJobData = {
      userId,
      dto: resolvedDto,
      language,
      ...(sourceVersion != null ? { sourceVersion } : {}),
      ...(reasonCode != null ? { reasonCode } : {}),
      ...(triggerKey != null ? { triggerKey } : {}),
    };
    if (sourceVersion == null) {
      const job = await this.queue.add(TODAY_ANALYSIS_JOB_NAME, data);
      return job.id ?? null;
    }

    const jobId = buildTodayAnalysisJobId(userId, date, sourceVersion);
    const existing = await this.queue.getJob(jobId);
    if (existing != null) {
      const state = await existing.getState();
      if (state !== 'completed' && state !== 'failed') {
        await existing.updateData({
          ...existing.data,
          ...data,
          sourceVersion: Math.max(
            existing.data.sourceVersion ?? sourceVersion,
            sourceVersion,
          ),
        });
        return jobId;
      }
      await existing.remove();
    }

    const job = await this.queue.add(TODAY_ANALYSIS_JOB_NAME, data, {
      jobId,
    });
    return job.id ?? null;
  }

  async getStatus(jobId: string) {
    return this.pollStatus(jobId);
  }
}
