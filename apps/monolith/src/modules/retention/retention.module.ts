import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/index.js';
import { RetentionService } from './services/retention.service.js';

/**
 * Global data retention module.
 *
 * Registers `RetentionService` which runs a daily BullMQ Repeatable Job
 * (via `CronJobsService`) for expired sessions, old read notifications, and
 * expired feedback suppressions.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
