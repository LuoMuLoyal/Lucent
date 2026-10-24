import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../config/runtime/runtime-config.types.js';
import { BullmqQueueFactory } from './queue.factory.js';
import { QUEUE_NAMES } from './queue-names.js';
import {
  MealAnalysisSweeperService,
  MEAL_ANALYSIS_REAP_CRON,
  MEAL_ANALYSIS_REAP_JOB_NAME,
} from '../../modules/daily-records/index.js';
import {
  DataRetentionService,
  DATA_RETENTION_CRON,
} from '../../modules/data-retention/index.js';
import {
  LifecycleService,
  LIFECYCLE_REFRESH_CRON,
} from '../../modules/today-suggestion/index.js';
import { WeeklyInsightSchedulerService } from '../../modules/notification-preferences/index.js';

/** BullMQ queue name for low-frequency cron jobs (lifecycle + data-retention). */
export const CRON_QUEUE_NAME = QUEUE_NAMES.cron;

/** Stable scheduler IDs — used by `upsertJobScheduler` for idempotent upsert. */
const SCHEDULER_DATA_RETENTION = 'data-retention-cleanup';
const SCHEDULER_LIFECYCLE = 'lifecycle-refresh';
const SCHEDULER_WEEKLY_INSIGHT = 'weekly-insight';
const SCHEDULER_MEAL_ANALYSIS_REAP = 'meal-analysis-reap';

/** Job names — the worker processor dispatches on these. */
const JOB_DATA_RETENTION = 'data-retention-cleanup';
const JOB_LIFECYCLE = 'lifecycle-refresh';
const JOB_WEEKLY_INSIGHT = 'weekly-insight';

/**
 * Registers and processes cron-driven tasks as BullMQ Repeatable Jobs.
 *
 * Replaces `@Cron` decorators with `queue.upsertJobScheduler()` so that
 * scheduling rules are stored in Redis and survive process restarts. In a
 * future multi-worker deployment, BullMQ's distributed dedup ensures each
 * repeatable job fires exactly once per cycle regardless of worker count.
 *
 * **Only low-frequency jobs live here.** `reminder-dispatch` (every minute)
 * moved to its owning module
 * (`medicine-reminders/services/dispatch-queue.service.ts`) under ADR-0025:
 * it needs its own queue so a slow dispatch cannot delay `lifecycle-refresh`
 * or `data-retention-cleanup`, and keeping a business call in this leaf layer
 * forced `common/` to import a business module.
 */
@Injectable()
export class CronJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CronJobsService.name);
  private cronQueue: Queue | null = null;
  /** Cron pattern currently registered for the meal-analysis reaper. */
  private mealReapCron: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly factory: BullmqQueueFactory,
    private readonly dataRetentionService: DataRetentionService,
    private readonly lifecycleService: LifecycleService,
    private readonly weeklyInsightSchedulerService: WeeklyInsightSchedulerService,
    private readonly mealAnalysisSweeperService: MealAnalysisSweeperService,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.factory.isAvailable) {
      this.logger.log('Cron jobs disabled; REDIS_URL not configured');
      return;
    }

    // Low-frequency queue: data-retention (daily) + lifecycle (every 5 min)
    const cronHandle = this.factory.createQueue({
      name: CRON_QUEUE_NAME,
      runtimeKey: CRON_QUEUE_NAME,
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
          case MEAL_ANALYSIS_REAP_JOB_NAME:
            await this.mealAnalysisSweeperService.reapStaleAnalyses();
            return;
          default:
            this.logger.warn(`Unknown cron job name: ${job.name}`);
        }
      },
    });

    this.cronQueue = cronHandle.queue;

    await this.registerSchedulers();

    this.unsubscribe =
      this.runtimeConfig?.subscribe((snapshot) => {
        const pattern = snapshot.values[EnvKey.MEAL_ANALYSIS_REAP_CRON];
        if (typeof pattern !== 'string' || pattern === this.mealReapCron) {
          return;
        }
        void this.reapplyMealReapCron(pattern);
      }) ?? null;
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
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
   * (node:26-alpine defaults to UTC).
   */
  private async registerSchedulers(): Promise<void> {
    const registrations: Promise<unknown>[] = [];
    this.mealReapCron = this.readMealReapCron();

    if (this.cronQueue != null) {
      const cronQueue = this.cronQueue;
      // Clean up the stale `reminder-dispatch` scheduler left behind by the
      // 2026-07-29 queue split. BullMQ repeatable schedulers persist in Redis
      // until explicitly removed, so the old rule on this queue would keep
      // firing `reminder-dispatch` here even though the job now belongs to
      // `medicine-reminders` (ADR-0025) and registers its own scheduler.
      registrations.push(
        cronQueue.removeJobScheduler('reminder-dispatch'),
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
        cronQueue.upsertJobScheduler(
          SCHEDULER_MEAL_ANALYSIS_REAP,
          { pattern: this.mealReapCron, tz: 'UTC' },
          { name: MEAL_ANALYSIS_REAP_JOB_NAME, data: {} },
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

  /** Published cron when present, otherwise the code baseline. */
  private readMealReapCron(): string {
    const pattern =
      this.runtimeConfig?.getSnapshot().values[EnvKey.MEAL_ANALYSIS_REAP_CRON];
    return typeof pattern === 'string' ? pattern : MEAL_ANALYSIS_REAP_CRON;
  }

  /**
   * Re-upserts the reaper's repeatable job with the published pattern. BullMQ
   * keys repeatable jobs by scheduler id, so this replaces the rule in place
   * instead of leaving the previous schedule running.
   *
   * A failure here is a warning: the old rule keeps firing, and the next
   * snapshot push retries the same call.
   */
  private async reapplyMealReapCron(pattern: string): Promise<void> {
    const queue = this.cronQueue;
    if (queue == null) {
      return;
    }
    try {
      await queue.upsertJobScheduler(
        SCHEDULER_MEAL_ANALYSIS_REAP,
        { pattern, tz: 'UTC' },
        { name: MEAL_ANALYSIS_REAP_JOB_NAME, data: {} },
      );
      this.mealReapCron = pattern;
      this.logger.log(`Meal-analysis reaper rescheduled: ${pattern}`);
    } catch (error) {
      this.logger.warn(
        `Failed to reschedule the meal-analysis reaper to "${pattern}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
