import { Module } from '@nestjs/common';
import { DailyRecordsModule } from '../../modules/daily-records/daily-records.module.js';
import { DataRetentionModule } from '../../modules/data-retention/data-retention.module.js';
import { TodaySuggestionModule } from '../../modules/today-suggestion/today-suggestion.module.js';
import { NotificationPreferencesModule } from '../../modules/notification-preferences/notification-preferences.module.js';
import { CronJobsService } from './cron-jobs.service.js';

/**
 * Registers the low-frequency BullMQ Repeatable Jobs that replace `@Cron`
 * decorators (lifecycle-refresh, data-retention-cleanup, weekly-insight,
 * meal-analysis-reap).
 *
 * Imports the modules that own those cron-driven services so that
 * `CronJobsService` can inject them. The service is self-contained — no other
 * module consumes it.
 *
 * **`MedicineRemindersModule` is deliberately absent.** `reminder-dispatch`
 * used to be registered here, which is what forced this leaf layer to import a
 * business module. It now lives in its owning module (ADR-0025), so every
 * import below is a module whose *cron service* is genuinely low-frequency.
 */
@Module({
  imports: [
    DailyRecordsModule,
    DataRetentionModule,
    TodaySuggestionModule,
    NotificationPreferencesModule,
  ],
  providers: [CronJobsService],
})
export class CronJobsModule {}
