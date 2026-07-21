import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { now } from '../../../common/helpers/date-time.utils';

/** Cron expression for daily cleanup — 3:00 AM UTC. */
export const DATA_RETENTION_CRON = '0 3 * * *';

/** Retention period for read notifications (30 days). */
const READ_NOTIFICATION_RETENTION_DAYS = 30;

/** Retention period before soft-deleted accounts are permanently deleted (30 days). */
const SOFT_DELETED_ACCOUNT_RETENTION_DAYS = 30;

/**
 * Periodically cleans up expired and stale data to prevent database bloat.
 *
 * Runs daily at 3:00 AM UTC and removes:
 * - Expired user sessions (`expiresAt` has passed)
 * - Read notifications older than 30 days
 * - Expired suggestion feedback suppressions (`expiresAt` has passed)
 * - Soft-deleted accounts past the 30-day retention window (permanent cascade delete)
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
    await this.cleanupSoftDeletedAccounts(currentTime);
  }

  /** Deletes user sessions whose `expiresAt` has passed. */
  private async cleanupExpiredSessions(currentTime: Date): Promise<void> {
    try {
      const result = await this.prisma.userSession.deleteMany({
        where: { expiresAt: { lt: currentTime } },
      });

      if (result.count > 0) {
        this.logger.log(`Deleted ${String(result.count)} expired session(s)`);
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
      threshold.setUTCDate(
        threshold.getUTCDate() - READ_NOTIFICATION_RETENTION_DAYS,
      );

      const result = await this.prisma.userNotification.deleteMany({
        where: {
          isRead: true,
          readAt: { lt: threshold },
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Deleted ${String(result.count)} read notification(s) older than ${String(READ_NOTIFICATION_RETENTION_DAYS)} days`,
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
          `Deleted ${String(result.count)} expired feedback suppression(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to cleanup expired feedback: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Permanently deletes soft-deleted accounts past the retention window. */
  private async cleanupSoftDeletedAccounts(currentTime: Date): Promise<void> {
    try {
      const threshold = new Date(currentTime);
      threshold.setUTCDate(
        threshold.getUTCDate() - SOFT_DELETED_ACCOUNT_RETENTION_DAYS,
      );

      // Delete directly with the same WHERE clause to avoid loading all
      // expired user IDs into memory and to avoid an oversized IN clause.
      // Prisma cascade deletes all related records via onDelete: Cascade.
      const result = await this.prisma.user.deleteMany({
        where: {
          deletedAt: { lt: threshold },
          status: 'deleted',
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Permanently deleted ${String(result.count)} soft-deleted account(s) past ${String(SOFT_DELETED_ACCOUNT_RETENTION_DAYS)}-day retention`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to cleanup soft-deleted accounts: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
