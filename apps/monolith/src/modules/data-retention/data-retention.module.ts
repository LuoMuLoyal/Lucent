import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { DataRetentionService } from './services/data-retention.service.js';

/**
 * Global data retention module.
 *
 * Registers `DataRetentionService` which runs a daily BullMQ Repeatable Job
 * (via `CronJobsService`) for expired sessions, old read notifications, and
 * expired feedback suppressions.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class DataRetentionModule {}
