import { Module } from '@nestjs/common';
import { DailyRecordsModule } from '../../modules/daily-records/daily-records.module.js';
import { DataRetentionModule } from '../../modules/data-retention/data-retention.module.js';
import { MedicineRemindersModule } from '../../modules/medicine-reminders/medicine-reminders.module.js';
import { TodaySuggestionModule } from '../../modules/today-suggestion/today-suggestion.module.js';
import { NotificationPreferencesModule } from '../../modules/notification-preferences/notification-preferences.module.js';
import { CronJobsService } from './cron-jobs.service.js';

/**
 * Registers BullMQ Repeatable Jobs that replace `@Cron` decorators.
 *
 * Imports the modules that own the cron-driven services so that
 * `CronJobsService` can inject them. The service is self-contained —
 * no other module consumes it.
 */
@Module({
  imports: [
    DailyRecordsModule,
    DataRetentionModule,
    MedicineRemindersModule,
    TodaySuggestionModule,
    NotificationPreferencesModule,
  ],
  providers: [CronJobsService],
})
export class CronJobsModule {}
