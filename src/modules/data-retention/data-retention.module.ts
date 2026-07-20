import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DataRetentionService } from './services';

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
