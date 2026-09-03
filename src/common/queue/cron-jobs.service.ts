import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { BullmqQueueFactory } from './queue.factory.js';
import {
  DataRetentionService,
  DATA_RETENTION_CRON,
} from '../../modules/data-retention/index.js';
import {
  LifecycleService,
  LIFECYCLE_REFRESH_CRON,
} from '../../modules/today-suggestion/index.js';
import {
  ReminderSchedulerService,
  REMINDER_SCHEDULER_CRON,
} from '../../modules/medicine-reminders/index.js';
import { WeeklyInsightSchedulerService } from '../../modules/notification-preferences/index.js';

/** BullMQ queue name for low-frequency cron jobs (lifecycle + data-retention). */
export const CRON_QUEUE_NAME = 'lucent-cron';

/** BullMQ queue name for the high-frequency reminder-dispatch job. */
export const REMINDER_QUEUE_NAME = 'lucent-reminder-dispatch';

/** Stable scheduler IDs — used by `upsertJobScheduler` for idempotent upsert. */
const SCHEDULER_DATA_RETENTION = 'data-retention-cleanup';
const SCHEDULER_LIFECYCLE = 'lifecycle-refresh';
const SCHEDULER_REMINDER = 'reminder-dispatch';
const SCHEDULER_WEEKLY_INSIGHT = 'weekly-insight';

/** Job names — the worker processor dispatches on these. */
const JOB_DATA_RETENTION = 'data-retention-cleanup';
const JOB_LIFECYCLE = 'lifecycle-refresh';
const JOB_REMINDER = 'reminder-dispatch';
const JOB_WEEKLY_INSIGHT = 'weekly-insight';

/**
 * Registers and processes cron-driven tasks as BullMQ Repeatable Jobs.
 *
 * Replaces `@Cron` decorators with `queue.upsertJobScheduler()` so that
 * scheduling rules are stored in Redis and survive process restarts. In a
 * future multi-worker deployment, BullMQ's distributed dedup ensures each
 * repeatable job fires exactly once per cycle regardless of worker count.
 *
 * **Queue separation**: `reminder-dispatch` (every minute) runs on a dedicated
 * queue [`REMINDER_QUEUE_NAME`] so that a slow dispatch cycle cannot block
 * `lifecycle-refresh` or `data-retention-cleanup`. The low-frequency jobs
 * share [`CRON_QUEUE_NAME`] with `workerConcurrency: 2`.
 */
@Injectable()
export class CronJobsService implements OnModuleInit {
  private readonly logger = new Logger(CronJobsService.name);
  private cronQueue: Queue | null = null;
  private reminderQueue: Queue | null = null;

  constructor(
    private readonly factory: BullmqQueueFactory,
    private readonly dataRetentionService: DataRetentionService,
    private readonly lifecycleService: LifecycleService,
    private readonly reminderSchedulerService: ReminderSchedulerService,
    private readonly weeklyInsightSchedulerService: WeeklyInsightSchedulerService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.factory.isAvailable) {
      this.logger.log('Cron jobs disabled; REDIS_URL not configured');
      return;
    }

    // Low-frequency queue: data-retention (daily) + lifecycle (every 5 min)
    const cronHandle = this.factory.createQueue({
      name: CRON_QUEUE_NAME,
      workerConcurrency: 2,
      processor: async (job) => {
        switch (job.name) {
          case JOB_DATA_RETENTION:
            await this.dataRetentionService.cleanupExpiredData();
            return;
          case JOB_LIFECYCLE:
            await this.lifecycleService.refreshLifecycleStates();
            return;
          case JOB_WEEKLY_INSIGHT:
            await this.weeklyInsightSchedulerService.runTick();
            return;
          default:
            this.logger.warn(`Unknown cron job name: ${job.name}`);
        }
      },
    });

    // High-frequency queue: reminder-dispatch (every minute)
    const reminderHandle = this.factory.createQueue({
      name: REMINDER_QUEUE_NAME,
      processor: async (job) => {
        switch (job.name) {
          case JOB_REMINDER:
            await this.reminderSchedulerService.dispatchDueReminders();
            return;
          default:
            this.logger.warn(`Unknown reminder job name: ${job.name}`);
        }
      },
    });

    this.cronQueue = cronHandle.queue;
    this.reminderQueue = reminderHandle.queue;

    await this.registerSchedulers();
  }

  /**
   * Idempotently registers all repeatable job schedulers on their respective
   * queues.
   *
   * Uses `upsertJobScheduler` with stable scheduler IDs so that changing
   * a cron expression updates the rule in-place — no stale rules left
   * behind in Redis (which `queue.add({ repeat })` would do).
   *
   * All schedules use `tz: 'UTC'` to match the production container timezone
   * (node:24-alpine defaults to UTC).
   */
  private async registerSchedulers(): Promise<void> {
    const registrations: Promise<unknown>[] = [];

    if (this.cronQueue != null) {
      const cronQueue = this.cronQueue;
      // Clean up stale scheduler left behind by the 2026-07-29 queue split.
      // `reminder-dispatch` was moved to REMINDER_QUEUE_NAME, but BullMQ
      // repeatable schedulers persist in Redis until explicitly removed.
      registrations.push(cronQueue.removeJobScheduler(SCHEDULER_REMINDER));
      registrations.push(
        cronQueue.upsertJobScheduler(
          SCHEDULER_DATA_RETENTION,
          { pattern: DATA_RETENTION_CRON, tz: 'UTC' },
          { name: JOB_DATA_RETENTION, data: {} },
        ),
        cronQueue.upsertJobScheduler(
          SCHEDULER_LIFECYCLE,
          { pattern: LIFECYCLE_REFRESH_CRON, tz: 'UTC' },
          { name: JOB_LIFECYCLE, data: {} },
        ),
        cronQueue.upsertJobScheduler(
          SCHEDULER_WEEKLY_INSIGHT,
          { pattern: '* * * * *', tz: 'UTC' },
          { name: JOB_WEEKLY_INSIGHT, data: {} },
        ),
      );
    }

    if (this.reminderQueue != null) {
      registrations.push(
        this.reminderQueue.upsertJobScheduler(
          SCHEDULER_REMINDER,
          { pattern: REMINDER_SCHEDULER_CRON, tz: 'UTC' },
          { name: JOB_REMINDER, data: {} },
        ),
      );
    }

    try {
      await Promise.all(registrations);
      this.logger.log('Cron repeatable jobs registered');
    } catch (error) {
      this.logger.error(
        'Failed to register cron repeatable jobs; scheduled tasks will not run until next restart',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
