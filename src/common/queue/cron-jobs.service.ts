import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { BullmqQueueFactory } from './queue.factory';
import { DataRetentionService } from '../../modules/data-retention/services/data-retention.service';
import { DATA_RETENTION_CRON } from '../../modules/data-retention/services/data-retention.service';
import { LifecycleService } from '../../modules/today-suggestion/services/lifecycle/service';
import { LIFECYCLE_REFRESH_CRON } from '../../modules/today-suggestion/constants/lifecycle.constants';
import { ReminderSchedulerService } from '../../modules/medicine-reminders/services/scheduler.service';
import { REMINDER_SCHEDULER_CRON } from '../../modules/medicine-reminders/services/scheduler.service';

/** BullMQ queue name for cron-driven repeatable jobs. */
export const CRON_QUEUE_NAME = 'lucent-cron';

/** Stable scheduler IDs — used by `upsertJobScheduler` for idempotent upsert. */
const SCHEDULER_DATA_RETENTION = 'data-retention-cleanup';
const SCHEDULER_LIFECYCLE = 'lifecycle-refresh';
const SCHEDULER_REMINDER = 'reminder-dispatch';

/** Job names — the worker processor dispatches on these. */
const JOB_DATA_RETENTION = 'data-retention-cleanup';
const JOB_LIFECYCLE = 'lifecycle-refresh';
const JOB_REMINDER = 'reminder-dispatch';

/**
 * Registers and processes cron-driven tasks as BullMQ Repeatable Jobs.
 *
 * Replaces `@Cron` decorators with `queue.upsertJobScheduler()` so that
 * scheduling rules are stored in Redis and survive process restarts. In a
 * future multi-worker deployment, BullMQ's distributed dedup ensures each
 * repeatable job fires exactly once per cycle regardless of worker count.
 *
 * The worker processor dispatches by `job.name` to the corresponding
 * business service method. All three tasks are idempotent (DB-level dedup),
 * so overlapping executions — though rare — are safe.
 */
@Injectable()
export class CronJobsService implements OnModuleInit {
  private readonly logger = new Logger(CronJobsService.name);
  private queue: Queue | null = null;

  constructor(
    private readonly factory: BullmqQueueFactory,
    private readonly dataRetentionService: DataRetentionService,
    private readonly lifecycleService: LifecycleService,
    private readonly reminderSchedulerService: ReminderSchedulerService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.factory.isAvailable) {
      this.logger.log('Cron jobs disabled; REDIS_URL not configured');
      return;
    }

    const handle = this.factory.createQueue({
      name: CRON_QUEUE_NAME,
      processor: async (job) => {
        switch (job.name) {
          case JOB_DATA_RETENTION:
            await this.dataRetentionService.cleanupExpiredData();
            return;
          case JOB_LIFECYCLE:
            await this.lifecycleService.refreshLifecycleStates();
            return;
          case JOB_REMINDER:
            await this.reminderSchedulerService.dispatchDueReminders();
            return;
          default:
            this.logger.warn(`Unknown cron job name: ${job.name}`);
        }
      },
    });

    this.queue = handle.queue;

    if (this.queue != null) {
      await this.registerSchedulers(this.queue);
      this.logger.log('Cron repeatable jobs registered');
    }
  }

  /**
   * Idempotently registers all three repeatable job schedulers.
   *
   * Uses `upsertJobScheduler` with stable scheduler IDs so that changing
   * a cron expression updates the rule in-place — no stale rules left
   * behind in Redis (which `queue.add({ repeat })` would do).
   *
   * All schedules use `tz: 'UTC'` to match the production container timezone
   * (node:24-alpine defaults to UTC).
   */
  private async registerSchedulers(queue: Queue): Promise<void> {
    await queue.upsertJobScheduler(
      SCHEDULER_DATA_RETENTION,
      { pattern: DATA_RETENTION_CRON, tz: 'UTC' },
      { name: JOB_DATA_RETENTION, data: {} },
    );

    await queue.upsertJobScheduler(
      SCHEDULER_LIFECYCLE,
      { pattern: LIFECYCLE_REFRESH_CRON, tz: 'UTC' },
      { name: JOB_LIFECYCLE, data: {} },
    );

    await queue.upsertJobScheduler(
      SCHEDULER_REMINDER,
      { pattern: REMINDER_SCHEDULER_CRON, tz: 'UTC' },
      { name: JOB_REMINDER, data: {} },
    );
  }
}
