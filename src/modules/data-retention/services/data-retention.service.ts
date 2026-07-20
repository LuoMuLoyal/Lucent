import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { now } from '../../../common/helpers/date-time.utils';

/** Cron expression for daily cleanup — 3:00 AM UTC. */
export const DATA_RETENTION_CRON = '0 3 * * *';

/** Retention period for read notifications (30 days). */
const READ_NOTIFICATION_RETENTION_DAYS = 30;

/**
 * Periodically cleans up expired and stale data to prevent database bloat.
 *
 * Runs daily at 3:00 AM UTC and removes:
 * - Expired user sessions (`expiresAt` has passed)
 * - Read notifications older than 30 days
 * - Expired suggestion feedback suppressions (`expiresAt` has passed)
 *
 * Uses `deleteMany` for bulk deletion. Errors are logged but do not
 * prevent the next cleanup category from running.
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(DATA_RETENTION_CRON)
  async cleanupExpiredData(): Promise<void> {
    const currentTime = now();

    await this.cleanupExpiredSessions(currentTime);
    await this.cleanupOldReadNotifications(currentTime);
    await this.cleanupExpiredFeedback(currentTime);
  }

  /** Deletes user sessions whose `expiresAt` has passed. */
  private async cleanupExpiredSessions(currentTime: Date): Promise<void> {
    try {
      const result = await this.prisma.userSession.deleteMany({
        where: { expiresAt: { lt: currentTime } },
      });

      if (result.count > 0) {
        this.logger.log(
          `Deleted ${result.count} expired session(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to cleanup expired sessions: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Deletes read notifications older than the retention period. */
  private async cleanupOldReadNotifications(currentTime: Date): Promise<void> {
    try {
      const threshold = new Date(currentTime);
      threshold.setUTCDate(threshold.getUTCDate() - READ_NOTIFICATION_RETENTION_DAYS);

      const result = await this.prisma.userNotification.deleteMany({
        where: {
          isRead: true,
          readAt: { lt: threshold },
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Deleted ${result.count} read notification(s) older than ${READ_NOTIFICATION_RETENTION_DAYS} days`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to cleanup old read notifications: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Deletes expired suggestion feedback suppressions. */
  private async cleanupExpiredFeedback(currentTime: Date): Promise<void> {
    try {
      const result = await this.prisma.userSuggestionFeedback.deleteMany({
        where: {
          expiresAt: { lt: currentTime },
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Deleted ${result.count} expired feedback suppression(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to cleanup expired feedback: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
