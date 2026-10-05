import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { resolveLocale } from '../../../common/index.js';
import { PrismaService } from '../../../prisma/index.js';

import { INotificationSender } from '../../notifications/index.js';
import type { OAuthProfile } from '../types/oauth.types.js';

/**
 * Security notifications for auth events.
 *
 * Copy is **persisted** with the row, so its language is fixed at write time.
 * These writes are fire-and-forget (the OAuth flow must not fail because a
 * notice could not be stored) and often run after the response, so the request
 * locale is not always reachable: the language therefore comes from the user's
 * stored preference, with an explicit override for callers that still hold the
 * request locale.
 *
 * The previous hardcoded Chinese meant an English-locale user received Chinese
 * security notices — the `notifications.*` i18n keys existed, they were simply
 * never used on this path.
 */
@Injectable()
export class AuthNotificationService {
  private readonly logger = new Logger(AuthNotificationService.name);

  constructor(
    private readonly notificationsService: INotificationSender,
    private readonly i18n: I18nService,
    private readonly prisma: PrismaService,
  ) {}

  async notifyOAuthLogin(
    userId: string,
    profile: OAuthProfile,
    locale?: string,
  ): Promise<void> {
    const lang = await this.resolveUserLocale(userId, locale);
    await this.createBestEffort(userId, {
      type: 'oauth_login',
      title: this.i18n.t('notifications.oauth_login_title', { lang }),
      content: this.i18n.t('notifications.oauth_login_content', {
        lang,
        args: { provider: this.providerLabel(profile.provider, lang) },
      }),
      action: '/account',
    });
  }

  async notifyIdentityLinked(
    userId: string,
    profile: OAuthProfile,
    locale?: string,
  ): Promise<void> {
    const lang = await this.resolveUserLocale(userId, locale);
    await this.createBestEffort(userId, {
      type: 'identity_linked',
      title: this.i18n.t('notifications.identity_linked_title', { lang }),
      content: this.i18n.t('notifications.identity_linked_content', {
        lang,
        args: { provider: this.providerLabel(profile.provider, lang) },
      }),
      action: '/account',
    });
  }

  /**
   * Resolves the language for a security notice.
   *
   * An explicit locale (from a caller that still has the request) wins;
   * otherwise the user's stored preference; otherwise English, matching the
   * shared `resolveLocale` fallback. A failed lookup must not suppress the
   * notice, so it degrades to the request locale.
   */
  private async resolveUserLocale(
    userId: string,
    explicit?: string,
  ): Promise<string> {
    if (explicit != null && explicit.trim().length > 0) {
      return resolveLocale(explicit);
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { profile: { select: { locale: true } } },
      });
      const stored = user?.profile?.locale;
      if (stored != null && stored.trim().length > 0) {
        return resolveLocale(stored);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to read locale for auth notification (user=${userId}); defaulting: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return resolveLocale(undefined);
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

  /**
   * Provider display name.
   *
   * `wechat_web` / `wechat_mobile` share one label, and the label is itself
   * localized (WeChat vs 微信), so it is resolved through i18n rather than a
   * hardcoded map. An unknown provider falls back to its raw id, which is what
   * the previous map did too.
   */
  private providerLabel(provider: string, locale: string): string {
    const known = new Set(['wechat_web', 'wechat_mobile', 'apple', 'qq']);
    if (!known.has(provider)) return provider;

    const key =
      provider === 'wechat_web' || provider === 'wechat_mobile'
        ? 'notifications.provider_wechat'
        : `notifications.provider_${provider}`;
    const translated: string = this.i18n.t(key, { lang: locale });
    return translated === key ? provider : translated;
  }
}
