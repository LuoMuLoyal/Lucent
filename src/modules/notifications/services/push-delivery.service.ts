import { Injectable, Logger } from '@nestjs/common';
import type { PushMessage, PushProvider } from './push-provider.port';

/** Push notification payload. */
export type PushPayload = PushMessage;

/**
 * Sends push notifications to a user's JPush alias.
 *
 * Delivery is best-effort: provider failures are logged and do not block the
 * in-app notification flow. When JPush credentials are absent, the provider
 * reports an unconfigured state and no network request is attempted.
 */
@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger(PushDeliveryService.name);

  constructor(private readonly provider: PushProvider) {}

  /**
   * Sends a push notification to the given user's JPush alias.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.provider.isConfigured) {
      this.logger.debug(
        `Push delivery skipped: JPush is not configured, userId=${userId}`,
      );
      return;
    }

    try {
      await this.provider.send([userId], payload);
    } catch (error) {
      this.logger.warn(
        `Push delivery failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
