import { Module } from '@nestjs/common';
import { RecordModule } from '../../modules/record/record.module.js';
import { RetentionModule } from '../../modules/retention/retention.module.js';
import { SuggestionModule } from '../../modules/suggestion/suggestion.module.js';
import { NotificationModule } from '../../modules/notification/notification.module.js';
import { CronJobsService } from './cron-jobs.service.js';

/**
 * Registers the low-frequency BullMQ Repeatable Jobs that replace `@Cron`
 * decorators (lifecycle-refresh, retention-cleanup, weekly-insight,
 * meal-analysis-reap).
 *
 * Imports the modules that own those cron-driven services so that
 * `CronJobsService` can inject them. The service is self-contained — no other
 * module consumes it.
 *
 * **`ReminderModule` is deliberately absent.** `reminder-dispatch`
 * used to be registered here, which is what forced this leaf layer to import a
 * business module. It now lives in its owning module (ADR-0025), so every
 * import below is a module whose *cron service* is genuinely low-frequency.
 */
@Module({
  imports: [
    RecordModule,
    RetentionModule,
    SuggestionModule,
    NotificationModule,
  ],
  providers: [CronJobsService],
})
export class CronJobsModule {}
