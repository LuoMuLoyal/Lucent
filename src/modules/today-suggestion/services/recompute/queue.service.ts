import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
import type { MaterializationReasonCode } from '../../types/materialization.types';

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

  constructor(factory: BullmqQueueFactory) {
    const handle = factory.createQueue<RecomputeJobData>({
      name: RECOMPUTE_QUEUE_NAME,
      workerConcurrency: 1,
      // Task 4 replaces this placeholder with the materialization worker.
      processor: () => Promise.resolve(),
    });
    this.queue = handle.queue;
  }

  get isConfigured(): boolean {
    return this.queue != null;
  }

  async enqueue(data: RecomputeJobData): Promise<string | null> {
    if (!this.queue) {
      return null;
    }

    const jobId = buildRecomputeJobId(data.userId, data.localDate);
    const existing = await this.queue.getJob(jobId);

    if (existing != null) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove();
      } else {
        const merged = this.mergeData(existing, data);
        await existing.updateData(merged);
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
