import { Injectable, Logger } from '@nestjs/common';
import type { PushMessage, PushProvider } from './push-provider.port';

/** Push notification payload. */
export type PushPayload = PushMessage;

/**
 * Push 发送结果（永不 reject）。
 *
 * - `sent: true`：provider 发送成功；
 * - `sent: false`：未配置或发送失败，`errorMessage` 仅在失败时给出
 *   （未配置时省略）。调度器据此落 push 审计行（delivered/failed）。
 */
export interface PushSendResult {
  sent: boolean;
  errorMessage?: string;
}

/**
 * Sends push notifications to a user's JPush alias.
 *
 * Delivery is best-effort: provider failures are logged and do not block the
 * in-app notification flow. When JPush credentials are absent, the provider
 * reports an unconfigured state and no network request is attempted —
 * `sendToUser` then resolves `{ sent: false }`.
 */
@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger(PushDeliveryService.name);

  constructor(private readonly provider: PushProvider) {}

  /**
   * Sends a push notification to the given user's JPush alias.
   *
   * Returns the send outcome instead of throwing — callers persist the result
   * as a delivery audit row (see ADR-0013).
   */
  async sendToUser(
    userId: string,
    payload: PushPayload,
  ): Promise<PushSendResult> {
    if (!this.provider.isConfigured) {
      this.logger.debug(
        `Push delivery skipped: JPush is not configured, userId=${userId}`,
      );
      return { sent: false };
    }

    try {
      await this.provider.send([userId], payload);
      return { sent: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Push delivery failed for user ${userId}: ${message}`);
      return { sent: false, errorMessage: message };
    }
  }
}
