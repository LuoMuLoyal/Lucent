import { Injectable } from '@nestjs/common';

import { NotificationsService } from '../../notifications';
import type { OAuthProfile } from '../types/oauth.types';

@Injectable()
export class AuthNotificationService {
  constructor(private readonly notificationsService: NotificationsService) {}

  async notifyOAuthLogin(userId: string, profile: OAuthProfile): Promise<void> {
    await this.notificationsService.create(userId, {
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
    await this.notificationsService.create(userId, {
      type: 'identity_linked',
      title: '账户绑定提醒',
      content: `您的账户已绑定${this.providerLabel(profile.provider)}身份。如非本人操作，请尽快联系客服。`,
      action: '/account',
    });
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
