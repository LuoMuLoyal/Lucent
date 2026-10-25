import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { QUEUE_NAMES } from '../../../../common/queue/queue-names.js';
import {
  REMINDER_SCHEDULER_CRON,
  ReminderDispatcher,
} from '../../application/ports/delivery-services.js';

/** BullMQ queue name for the high-frequency reminder-dispatch job. */
export const REMINDER_QUEUE_NAME = QUEUE_NAMES.reminderDispatch;

/** Stable scheduler id — `upsertJobScheduler` keys repeatable jobs by it. */
const SCHEDULER_REMINDER = 'reminder-dispatch';

/** Job name the worker processor dispatches on. */
const JOB_REMINDER = 'reminder-dispatch';

/**
 * Owns the `reminder-dispatch` repeatable job (ADR-0025).
 *
 * The queue and its processor used to live in `common/queue/cron-jobs.service.ts`
 * purely because that is where the other repeatable jobs were registered. That
 * put a business call — `dispatchDueReminders()` — inside the shared layer, and
 * `common/` had to import the whole `medicine-reminders` module to reach it.
 * `common/` is a leaf: it may know a queue *name*, never a business module.
 *
 * The queue is unchanged (same name, same minute cadence, same dedicated queue
 * so a slow dispatch cannot delay `lifecycle-refresh` or
 * `data-retention-cleanup`); only its owner moved. The owning module now
 * registers its own repeatable job, which is also what makes the fan-out
 * consumers in `subscriptions.ts` and the cron jobs consistent: both are
 * declared by the module that runs them.
 */
@Injectable()
export class ReminderDispatchQueue implements OnModuleInit {
  private readonly logger = new Logger(ReminderDispatchQueue.name);
  private queue: Queue | null = null;

  constructor(
    private readonly factory: BullmqQueueFactory,
    private readonly schedulerService: ReminderDispatcher,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.factory.isAvailable) {
      this.logger.log('Reminder dispatch disabled; REDIS_URL not configured');
      return;
    }

    const handle = this.factory.createQueue({
      name: REMINDER_QUEUE_NAME,
      runtimeKey: REMINDER_QUEUE_NAME,
      processor: async (job) => {
        if (job.name !== JOB_REMINDER) {
          this.logger.warn(`Unknown reminder job name: ${job.name}`);
          return;
        }
        await this.schedulerService.dispatchDueReminders();
      },
    });
    this.queue = handle.queue;

    if (this.queue == null) {
      return;
    }
    try {
      await this.queue.upsertJobScheduler(
        SCHEDULER_REMINDER,
        // UTC matches the production container timezone (node:26-alpine).
        { pattern: REMINDER_SCHEDULER_CRON, tz: 'UTC' },
        { name: JOB_REMINDER, data: {} },
      );
      this.logger.log('Reminder dispatch repeatable job registered');
    } catch (error) {
      this.logger.error(
        'Failed to register the reminder-dispatch repeatable job; it will not run until the next restart',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
