import { Injectable, Logger } from '@nestjs/common';
import type { PushMessage, PushProvider } from './push-provider.port';

/** Push notification payload. */
export type PushPayload = PushMessage;

/**
 * Push 发送结果（永不 reject）。
 *
 * - `sent: true`：provider 发送成功；
 * - `sent: false`：未配置或发送失败。未配置时 `errorMessage` 为固定值
 *   `push_not_configured`，真失败时为 provider 异常信息——调度器据此落
 *   push 审计行（delivered/failed），区分「未配置」与「真失败」。
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
 * `sendToUser` then resolves `{ sent: false, errorMessage: 'push_not_configured' }`.
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
      return { sent: false, errorMessage: 'push_not_configured' };
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
