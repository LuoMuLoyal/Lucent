import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { QUEUE_NAMES } from '../../../../common/queue/queue-names.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import {
  SUGGESTION_EVENT_TRIGGER_JOB,
  type DomainEventJobData,
  type EventConsumerRegistry,
} from '../../../../common/index.js';
import type { RecomputeJobData } from './recompute-job.types.js';
import { RecomputeEventTriggerService } from './event-trigger.service.js';
import { SuggestionRecomputeWorkerService } from './worker.service.js';

export const RECOMPUTE_QUEUE_NAME = QUEUE_NAMES.suggestionRecompute;
export const RECOMPUTE_JOB_NAME = 'recompute';
/** Coalesce related writes into one bounded recompute job. */
export const RECOMPUTE_DEBOUNCE_MS = 1_000;

// Re-exported so existing importers keep working; the definition lives in its
// own module so the trigger/worker pair does not cycle through this service.
export type { RecomputeJobData } from './recompute-job.types.js';

export function buildRecomputeJobId(userId: string, localDate: string): string {
  // BullMQ rejects custom job IDs containing ':' (Job.validateOptions), so use
  // '-' as the segment separator.
  return `${RECOMPUTE_QUEUE_NAME}-${userId}-${localDate}`;
}

@Injectable()
export class RecomputeQueueService {
  private readonly logger = new Logger(RecomputeQueueService.name);
  private readonly queue: Queue<RecomputeJobData | DomainEventJobData> | null;
  private readonly inlineJobs = new Map<string, Promise<void>>();

  constructor(
    factory: BullmqQueueFactory,
    private readonly worker: SuggestionRecomputeWorkerService,
    private readonly eventTrigger: RecomputeEventTriggerService,
    private readonly consumers: EventConsumerRegistry,
    @Optional() private readonly metricsService?: MetricsService,
  ) {
    const handle = factory.createQueue<RecomputeJobData | DomainEventJobData>({
      name: RECOMPUTE_QUEUE_NAME,
      runtimeKey: RECOMPUTE_QUEUE_NAME,
      processor: async (job) => {
        // One queue, two job shapes: `recompute` carries an already-resolved
        // RecomputeJobData, `event-trigger` carries a fanned-out event that has
        // to be resolved first. Dispatching on the name is what keeps the two
        // apart — forwarding an event payload to `worker.process` would read
        // `localDate`/`sourceVersion` as undefined.
        if (job.name === SUGGESTION_EVENT_TRIGGER_JOB) {
          await this.processEventTrigger(job.data as DomainEventJobData);
          return;
        }
        await this.worker.process(job.data as RecomputeJobData);
      },
    });
    this.queue = handle.queue;

    if (handle.queue == null) {
      // No Redis: the fan-out calls this directly so local development and e2e
      // keep invalidating caches and recomputing.
      this.consumers.register(
        RECOMPUTE_QUEUE_NAME,
        SUGGESTION_EVENT_TRIGGER_JOB,
        (data) => this.processEventTrigger(data),
      );
    }
  }

  /**
   * Resolves a fanned-out event into a recompute job and runs it. Shares the
   * inline fallback with `enqueue`, so an unconfigured queue still recomputes.
   */
  private async processEventTrigger(data: DomainEventJobData): Promise<void> {
    const job = await this.eventTrigger.resolve(data);
    if (job == null) {
      return;
    }
    await this.enqueue(job);
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
          // A job found under a recompute id is a recompute job by
          // construction: `event-trigger` jobs use the fan-out's own
          // `eventId:job:queue` id, which never collides with this one.
          //
          // A waiting job is **rescheduled** (`changeDelay` below), so a burst
          // keeps pushing the window back and one recompute covers the whole
          // burst. That is deliberate here and deliberately *not* what
          // `MedicineRiskRefreshQueueService` does: a recompute is expensive
          // (rule engine + LLM copy), so waiting for the user to finish typing
          // is the better trade; a risk check is cheap and time-sensitive, so
          // there it bounds staleness instead. Two policies, one reason each.
          const existingRecompute = existing as unknown as {
            data: RecomputeJobData;
            updateData: (data: RecomputeJobData) => Promise<void>;
          };
          const merged = this.mergeData(existingRecompute, data);
          await existingRecompute.updateData(merged);
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
