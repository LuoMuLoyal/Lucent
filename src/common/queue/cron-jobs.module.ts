import { Module } from '@nestjs/common';
import { DataRetentionModule } from '../../modules/data-retention/data-retention.module';
import { MedicineRemindersModule } from '../../modules/medicine-reminders/medicine-reminders.module';
import { TodaySuggestionModule } from '../../modules/today-suggestion/today-suggestion.module';
import { CronJobsService } from './cron-jobs.service';

/**
 * Registers BullMQ Repeatable Jobs that replace `@Cron` decorators.
 *
 * Imports the three modules that own the cron-driven services so that
 * `CronJobsService` can inject them. The service is self-contained —
 * no other module consumes it.
 */
@Module({
  imports: [
    DataRetentionModule,
    MedicineRemindersModule,
    TodaySuggestionModule,
  ],
  providers: [CronJobsService],
})
export class CronJobsModule {}
