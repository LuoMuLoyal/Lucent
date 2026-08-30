import { Injectable, Logger } from '@nestjs/common';

import { INotificationSender } from '../../notifications';
import type { OAuthProfile } from '../types/oauth.types';

@Injectable()
export class AuthNotificationService {
  private readonly logger = new Logger(AuthNotificationService.name);

  constructor(private readonly notificationsService: INotificationSender) {}

  async notifyOAuthLogin(userId: string, profile: OAuthProfile): Promise<void> {
    await this.createBestEffort(userId, {
      type: 'oauth_login',
      title: '账户登录提醒',
      content: `您的账户通过${this.providerLabel(profile.provider)}登录。如非本人操作，请尽快联系客服。`,
      action: '/account',
    });
  }

  async notifyIdentityLinked(
    userId: string,
    profile: OAuthProfile,
  ): Promise<void> {
    await this.createBestEffort(userId, {
      type: 'identity_linked',
      title: '账户绑定提醒',
      content: `您的账户已绑定${this.providerLabel(profile.provider)}身份。如非本人操作，请尽快联系客服。`,
      action: '/account',
    });
  }

  /**
   * Notification sends are best-effort by contract: a failed notification
   * write (DomainFailure Err or a rejected DB call) is logged with a
   * structured warning and never propagates to the caller — the OAuth flow
   * must not break because a reminder notification could not be persisted.
   */
  private async createBestEffort(
    userId: string,
    dto: Parameters<INotificationSender['create']>[1],
  ): Promise<void> {
    try {
      const result = await this.notificationsService.create(userId, dto);
      if (result.isErr()) {
        this.logger.warn(
          `Failed to create auth notification for user ${userId}: ${result.error.code}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to create auth notification for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private providerLabel(provider: string): string {
    const labels: Record<string, string> = {
      wechat_web: '微信',
      wechat_mobile: '微信',
      apple: 'Apple',
      qq: 'QQ',
    };
    return labels[provider] ?? provider;
  }
}
