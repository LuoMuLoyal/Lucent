import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { BullmqQueueFactory } from '../../../common/queue/queue.factory.js';
import { QUEUE_NAMES } from '../../../common/queue/queue-names.js';
import {
  EventConsumerRegistry,
  REPORT_CACHE_INVALIDATION_JOB,
  type DomainEventJobData,
} from '../../../common/index.js';
import { ReportsService } from './dashboard.service.js';

/** BullMQ queue the reports dashboard cache invalidation runs on. */
export const REPORT_CACHE_INVALIDATION_QUEUE_NAME =
  QUEUE_NAMES.reportCacheInvalidation;

/**
 * Consumes `report-cache-invalidation#invalidate` jobs (ADR-0025).
 *
 * Replaces the in-process `@OnEvent` listener: a dashboard cache entry is a
 * pure accelerator over the database, so invalidating it belongs on a queue —
 * it may be late, may be retried, and must never make a write request wait.
 *
 * With Redis the job arrives through BullMQ; without it the module registers
 * {@link invalidateFromEvent} as the inline consumer, so local development and
 * e2e keep working. Either way the only data needed is the event's payload.
 */
@Injectable()
export class ReportsCacheInvalidationQueueService implements OnModuleInit {
  private readonly logger = new Logger(
    ReportsCacheInvalidationQueueService.name,
  );

  constructor(
    private readonly factory: BullmqQueueFactory,
    private readonly reportsService: ReportsService,
    private readonly consumers: EventConsumerRegistry,
  ) {}

  onModuleInit(): void {
    const handle = this.factory.createQueue<DomainEventJobData>({
      name: REPORT_CACHE_INVALIDATION_QUEUE_NAME,
      runtimeKey: REPORT_CACHE_INVALIDATION_QUEUE_NAME,
      processor: async (job) => {
        if (job.name !== REPORT_CACHE_INVALIDATION_JOB) {
          this.logger.warn(
            `Unknown ${REPORT_CACHE_INVALIDATION_QUEUE_NAME} job: ${job.name}`,
          );
          return;
        }
        await this.invalidateFromEvent(job.data);
      },
    });

    if (handle.queue == null) {
      this.consumers.register(
        REPORT_CACHE_INVALIDATION_QUEUE_NAME,
        REPORT_CACHE_INVALIDATION_JOB,
        (data) => this.invalidateFromEvent(data),
      );
    }
  }

  /**
   * Drops the user's cached dashboard. Idempotent by nature: deleting an
   * already-deleted key is a no-op, and `ReportsService` itself downgrades a
   * cache failure to a warning (TTL is the safety net).
   */
  async invalidateFromEvent(data: DomainEventJobData): Promise<void> {
    const userId = data['userId'];
    if (typeof userId !== 'string' || userId.length === 0) {
      // A malformed payload must not be retried forever: BullMQ would re-run
      // the same broken job on every attempt. No dedupe record is needed here
      // — deleting an already-deleted cache key is a no-op.
      this.logger.warn(
        `Skipping report cache invalidation for ${data.eventType}: payload has no userId (eventId=${data.eventId})`,
      );
      return;
    }
    await this.reportsService.invalidateUserDashboard(userId);
  }
}
