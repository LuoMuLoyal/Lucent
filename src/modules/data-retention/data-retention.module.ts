import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { DataRetentionService } from './services/data-retention.service';

/**
 * Global data retention module.
 *
 * Registers `DataRetentionService` which runs a daily `@Cron` cleanup
 * for expired sessions, old read notifications, and expired feedback
 * suppressions.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [DataRetentionService],
})
export class DataRetentionModule {}
