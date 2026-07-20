import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** Push notification payload. */
export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Sends push notifications to registered devices.
 *
 * Graceful degradation: when no FCM/APNs provider is configured, all
 * calls silently succeed without sending anything — the service logs
 * at debug level so the call path is visible in development.
 *
 * When a concrete provider is wired (via environment variables), this
 * service will query `UserDevice` rows where `notificationsEnabled = true`
 * and dispatch the push via the configured SDK.
 */
@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger(PushDeliveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sends a push notification to all enabled devices for the given user.
   *
   * Currently a no-op stub that queries devices and logs the attempt.
   * Replace the inner block with FCM/APNs SDK calls when credentials
   * are provisioned.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    try {
      const devices = await this.prisma.userDevice.findMany({
        where: { userId, notificationsEnabled: true },
        select: {
          id: true,
          pushToken: true,
          platform: true,
        },
      });

      if (devices.length === 0) {
        return;
      }

      // TODO(v1.1.0): dispatch via FCM/APNs SDK based on `platform`.
      // For now, log the attempt so the call path is visible.
      this.logger.debug(
        `Push notification stub: userId=${userId}, devices=${devices.length}, title="${payload.title}"`,
      );
    } catch (error) {
      this.logger.warn(
        `Push delivery failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
