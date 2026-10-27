import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

import {
  EventConsumerRegistry,
  MEDICINE_RISK_REFRESH_JOB,
  type DomainEventJobData,
} from '../../../../common/index.js';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { QUEUE_NAMES } from '../../../../common/queue/queue-names.js';
import { MedicineRiskCheckService } from '../../application/use_cases/check-risk.js';

/** BullMQ queue the medicines risk refresh runs on. */
export const MEDICINE_RISK_REFRESH_QUEUE_NAME = QUEUE_NAMES.medicineRiskRefresh;

/**
 * Delay before a triggered risk check runs, coalescing a burst of changes.
 *
 * A user adding a medicine and then creating a reminder fires two events in
 * quick succession; the delay makes that one check instead of two.
 */
export const MEDICINE_RISK_REFRESH_DELAY_MS = 5_000;

/**
 * Refreshes a user's risk assessment after an upstream change (ADR-0025).
 *
 * Replaces the in-process listener that debounced with a per-user `setTimeout`.
 * Moving the debounce into the queue buys two things the timer could not:
 *
 * - **A restart no longer loses a pending refresh.** A `setTimeout` lives in
 *   one process's memory; a delayed BullMQ job lives in Redis.
 * - **The wait is visible.** A delayed job shows up on the queue board, so
 *   "risk is stale for 4 more seconds" is observable rather than implied.
 *
 * The job id is keyed by user alone, matching the old `pendingTimers` map,
 * which was also keyed by user: one user's burst collapses into one check.
 */
@Injectable()
export class MedicineRiskRefreshQueueService implements OnModuleInit {
  private readonly logger = new Logger(MedicineRiskRefreshQueueService.name);
  private readonly queue: Queue<DomainEventJobData> | null;

  constructor(
    factory: BullmqQueueFactory,
    private readonly riskCheckService: MedicineRiskCheckService,
    private readonly consumers: EventConsumerRegistry,
  ) {
    const handle = factory.createQueue<DomainEventJobData>({
      name: MEDICINE_RISK_REFRESH_QUEUE_NAME,
      runtimeKey: MEDICINE_RISK_REFRESH_QUEUE_NAME,
      processor: async (job) => {
        if (job.name !== MEDICINE_RISK_REFRESH_JOB) {
          this.logger.warn(
            `Unknown ${MEDICINE_RISK_REFRESH_QUEUE_NAME} job: ${job.name}`,
          );
          return;
        }
        await this.refreshForEvent(job.data);
      },
    });
    this.queue = handle.queue;
  }

  onModuleInit(): void {
    if (this.queue == null) {
      // No Redis: the fan-out calls the handler directly, so local development
      // and e2e still refresh. Without a queue there is no debounce window —
      // the refresh runs on the event instead of 5 seconds later.
      this.consumers.register(
        MEDICINE_RISK_REFRESH_QUEUE_NAME,
        MEDICINE_RISK_REFRESH_JOB,
        (data) => this.refreshForEvent(data),
      );
    }
  }

  /**
   * Schedules the refresh for an event's user, or runs it inline when there is
   * no queue. A second event inside the delay window is **not** rescheduled:
   * see {@link enqueueRefresh} for why.
   */
  async refreshForEvent(data: DomainEventJobData): Promise<void> {
    const userId = data['userId'];
    if (typeof userId !== 'string' || userId.length === 0) {
      // A malformed payload must not be retried forever.
      this.logger.warn(
        `Skipping risk refresh for ${data.eventType}: payload has no userId (eventId=${data.eventId})`,
      );
      return;
    }

    // Mark stale first, and unconditionally: the record must read as stale even
    // if scheduling fails, and the old listener behaved the same way.
    try {
      await this.riskCheckService.markStale(userId);
    } catch (error) {
      this.logger.warn(
        `Failed to mark risk check stale for ${userId}; scheduling the check anyway`,
        error instanceof Error ? error.message : String(error),
      );
    }

    if (this.queue == null) {
      await this.runCheck(userId);
      return;
    }
    await this.enqueueRefresh(userId, data);
  }

  /**
   * Enqueues the debounced check under a per-user job id.
   *
   * A job already waiting under that id is **left alone**, deliberately: the
   * check runs 5 seconds after the *first* change in a burst, and a later
   * change schedules the next one. Pushing the deadline back on every event —
   * which is what the `setTimeout` this replaces did, and what
   * `RecomputeQueueService` still does — means a user who edits medication more
   * often than once per window never reaches a check at all.
   *
   * **This is deliberately the opposite of `RecomputeQueueService`'s policy, and
   * the difference is a cost/latency trade-off, not an inconsistency.** A risk
   * check is cheap (static rules only) and time-sensitive, so bounding staleness
   * wins. A suggestion recompute is expensive (rule engine + LLM copy), so
   * waiting for the user to finish typing before computing once is the better
   * trade. Do not "unify" them without re-deciding that trade-off.
   */
  private async enqueueRefresh(
    userId: string,
    data: DomainEventJobData,
  ): Promise<void> {
    const queue = this.queue;
    if (queue == null) {
      return;
    }
    const jobId = buildRiskRefreshJobId(userId);
    try {
      const existing = await queue.getJob(jobId);
      if (existing != null) {
        const state = await existing.getState();
        if (state !== 'completed' && state !== 'failed') {
          // Still waiting or running: it will cover this change too.
          return;
        }
        await existing.remove();
      }
      await queue.add(MEDICINE_RISK_REFRESH_JOB, data, {
        jobId,
        delay: MEDICINE_RISK_REFRESH_DELAY_MS,
      });
    } catch (error) {
      // The queue is a scheduling aid; a Redis problem must not drop the
      // refresh entirely, and `markStale` above already flagged the record.
      this.logger.warn(
        `Failed to enqueue risk refresh for ${userId}, running inline: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.runCheck(userId);
    }
  }

  /** Runs the static check and logs a failure without throwing. */
  private async runCheck(userId: string): Promise<void> {
    await this.riskCheckService.runStaticCheck(userId).match(
      () => undefined,
      (error) => {
        // Keep stale=true: the next event or a manual trigger retries.
        this.logger.warn(
          { error },
          `Async static risk check failed for ${userId}`,
        );
      },
    );
  }
}

/** Job id keyed by user, so one user's burst coalesces into one check. */
export function buildRiskRefreshJobId(userId: string): string {
  // BullMQ rejects custom job ids containing ':' unless exactly 3 segments.
  return `${MEDICINE_RISK_REFRESH_QUEUE_NAME}-${userId}`;
}
