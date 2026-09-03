import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import type { MaterializationReasonCode } from '../../types/materialization.types.js';
import { SuggestionRecomputeWorkerService } from './worker.service.js';

export const RECOMPUTE_QUEUE_NAME = 'suggestion-recompute';
export const RECOMPUTE_JOB_NAME = 'recompute';
/** Coalesce related writes into one bounded recompute job. */
export const RECOMPUTE_DEBOUNCE_MS = 1_000;

export interface RecomputeJobData {
  userId: string;
  localDate: string;
  sourceVersion: number;
  reasonCodes: MaterializationReasonCode[];
}

export function buildRecomputeJobId(userId: string, localDate: string): string {
  return `${RECOMPUTE_QUEUE_NAME}:${userId}:${localDate}`;
}

@Injectable()
export class RecomputeQueueService {
  private readonly logger = new Logger(RecomputeQueueService.name);
  private readonly queue: Queue<RecomputeJobData> | null;
  private readonly inlineJobs = new Map<string, Promise<void>>();

  constructor(
    factory: BullmqQueueFactory,
    private readonly worker: SuggestionRecomputeWorkerService,
    @Optional() private readonly metricsService?: MetricsService,
  ) {
    const handle = factory.createQueue<RecomputeJobData>({
      name: RECOMPUTE_QUEUE_NAME,
      workerConcurrency: 1,
      processor: async (job) => this.worker.process(job.data),
    });
    this.queue = handle.queue;
  }

  get isConfigured(): boolean {
    return this.queue != null;
  }

  async enqueue(data: RecomputeJobData): Promise<string | null> {
    this.metricsService?.recordSuggestionRecomputeEnqueue();

    if (!this.queue) {
      await this.processInline(data);
      return null;
    }

    const jobId = buildRecomputeJobId(data.userId, data.localDate);
    try {
      const existing = await this.queue.getJob(jobId);

      if (existing != null) {
        const state = await existing.getState();
        if (state === 'completed' || state === 'failed') {
          await existing.remove();
        } else {
          const merged = this.mergeData(existing, data);
          await existing.updateData(merged);
          this.metricsService?.recordSuggestionRecomputeDedupe();
          if (state === 'delayed') {
            await existing.changeDelay(RECOMPUTE_DEBOUNCE_MS);
          }
          return jobId;
        }
      }

      const job = await this.queue.add(RECOMPUTE_JOB_NAME, data, {
        jobId,
        delay: RECOMPUTE_DEBOUNCE_MS,
      });
      this.logger.debug(`Enqueued suggestion recompute ${jobId}`, {
        userId: data.userId,
        localDate: data.localDate,
        sourceVersion: data.sourceVersion,
      });
      return job.id ?? jobId;
    } catch (error) {
      this.logger.error(
        `Failed to enqueue suggestion recompute, processing inline: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.processInline(data);
      return jobId;
    }
  }

  private async processInline(data: RecomputeJobData): Promise<void> {
    const key = buildRecomputeJobId(data.userId, data.localDate);
    const previous = this.inlineJobs.get(key) ?? Promise.resolve();
    const current = previous
      .catch((prevError: unknown) => {
        this.logger.warn(
          `Previous inline recompute failed for ${key}: ${prevError instanceof Error ? prevError.message : String(prevError)}`,
        );
      })
      .then(() => this.worker.process(data));
    this.inlineJobs.set(key, current);

    try {
      await current;
    } finally {
      if (this.inlineJobs.get(key) === current) {
        this.inlineJobs.delete(key);
      }
    }
  }

  private mergeData(
    existing: { data: RecomputeJobData },
    incoming: RecomputeJobData,
  ): RecomputeJobData {
    return {
      ...existing.data,
      ...incoming,
      sourceVersion: Math.max(
        existing.data.sourceVersion,
        incoming.sourceVersion,
      ),
      reasonCodes: [
        ...new Set([...existing.data.reasonCodes, ...incoming.reasonCodes]),
      ],
    };
  }
}
