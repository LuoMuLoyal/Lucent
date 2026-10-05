import { errAsync, okAsync } from '../../../common/result/index.js';
import { createDomainFailure } from '../../../common/result/index.js';
import { makeTestI18n } from '../../../common/tests/test-i18n.js';
import type { I18nService } from 'nestjs-i18n';
import type { NotificationsService } from '../../notifications/index.js';
import type { OAuthProfile } from '../types/oauth.types.js';
import { AuthNotificationService } from './notification.service.js';

const i18n = makeTestI18n() as unknown as I18nService;

describe('AuthNotificationService', () => {
  let service: AuthNotificationService;
  let notificationsService: vi.Mocked<NotificationsService>;
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn> };
  };

  /** Builds the service with a user whose stored locale is [locale]. */
  function build(locale: string | null = null): AuthNotificationService {
    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ profile: { locale } }),
      },
    };
    return new AuthNotificationService(
      notificationsService,
      i18n,
      prisma as never,
    );
  }

  beforeEach(() => {
    notificationsService = {
      create: vi.fn().mockReturnValue(okAsync({} as never)),
    } as unknown as vi.Mocked<NotificationsService>;

    service = build();
  });

  describe('notifyOAuthLogin', () => {
    it('creates a notification with provider label', async () => {
      const profile: OAuthProfile = {
        provider: 'wechat_web',
        providerUserId: 'wx-123',
        nickname: 'TestUser',
      };

      await service.notifyOAuthLogin('user-1', profile, 'zh-CN');

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          type: 'oauth_login',
          title: '账户登录提醒',
          content: expect.stringContaining('微信'),
          action: '/account',
        }),
      );
    });

    it('renders in English for an English request locale', async () => {
      const profile: OAuthProfile = {
        provider: 'wechat_web',
        providerUserId: 'wx-123',
      };

      await service.notifyOAuthLogin('user-1', profile, 'en-US');

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          title: 'Account sign-in alert',
          content: expect.stringContaining('WeChat'),
        }),
      );
    });

    it("falls back to the user's stored locale when the caller has none", async () => {
      // The write is fire-and-forget and may run after the response, so the
      // request locale is not always reachable.
      service = build('en');

      await service.notifyOAuthLogin('user-1', {
        provider: 'qq',
        providerUserId: 'qq-1',
      });

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ title: 'Account sign-in alert' }),
      );
    });

    it('defaults to English when neither locale is available', async () => {
      service = build(null);

      await service.notifyOAuthLogin('user-1', {
        provider: 'qq',
        providerUserId: 'qq-1',
      });

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ title: 'Account sign-in alert' }),
      );
    });

    it('still notifies when the locale lookup fails', async () => {
      prisma = {
        user: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) },
      };
      service = new AuthNotificationService(
        notificationsService,
        i18n,
        prisma as never,
      );

      await service.notifyOAuthLogin('user-1', {
        provider: 'qq',
        providerUserId: 'qq-1',
      });

      expect(notificationsService.create).toHaveBeenCalled();
    });

    it('uses the Apple label for the apple provider', async () => {
      await service.notifyOAuthLogin(
        'user-1',
        { provider: 'apple', providerUserId: 'apple-123' },
        'en',
      );

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ content: expect.stringContaining('Apple') }),
      );
    });

    it('uses the QQ label for the qq provider', async () => {
      await service.notifyOAuthLogin(
        'user-1',
        { provider: 'qq', providerUserId: 'qq-123' },
        'en',
      );

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ content: expect.stringContaining('QQ') }),
      );
    });

    it('falls back to raw provider name for unknown providers', async () => {
      // `provider` is a union in `OAuthProfile`; the cast exercises the
      // defensive branch for a provider added upstream but not labelled here.
      await service.notifyOAuthLogin(
        'user-1',
        {
          provider: 'github',
          providerUserId: 'gh-1',
        } as unknown as OAuthProfile,
        'en',
      );

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          content: expect.stringContaining('github'),
        }),
      );
    });

    it('localizes the WeChat label per locale', async () => {
      const wechat: OAuthProfile = {
        provider: 'wechat_mobile',
        providerUserId: 'wx-m',
      };

      await service.notifyOAuthLogin('user-1', wechat, 'zh-CN');
      expect(notificationsService.create).toHaveBeenLastCalledWith(
        'user-1',
        expect.objectContaining({ content: expect.stringContaining('微信') }),
      );

      await service.notifyOAuthLogin('user-1', wechat, 'en');
      expect(notificationsService.create).toHaveBeenLastCalledWith(
        'user-1',
        expect.objectContaining({ content: expect.stringContaining('WeChat') }),
      );
    });
  });

  describe('notifyIdentityLinked', () => {
    it('creates a linked notification in the requested language', async () => {
      await service.notifyIdentityLinked(
        'user-1',
        { provider: 'wechat_web', providerUserId: 'wx-1' },
        'en',
      );

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          type: 'identity_linked',
          title: 'Account linked',
          content: expect.stringContaining('WeChat'),
        }),
      );
    });

    it('renders Chinese when requested', async () => {
      await service.notifyIdentityLinked(
        'user-1',
        { provider: 'wechat_web', providerUserId: 'wx-1' },
        'zh-CN',
      );

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          title: '账户绑定提醒',
          content: expect.stringContaining('微信'),
        }),
      );
    });
  });

  describe('best-effort delivery', () => {
    it('never throws when the write fails with a domain failure', async () => {
      notificationsService.create = vi
        .fn()
        .mockReturnValue(
          errAsync(
            createDomainFailure({ kind: 'internal', code: 'INTERNAL_ERROR' }),
          ),
        );

      await expect(
        service.notifyOAuthLogin(
          'user-1',
          { provider: 'qq', providerUserId: 'qq-1' },
          'en',
        ),
      ).resolves.toBeUndefined();
    });

    it('never throws when the write rejects', async () => {
      notificationsService.create = vi
        .fn()
        .mockRejectedValue(new Error('db down'));

      await expect(
        service.notifyIdentityLinked(
          'user-1',
          { provider: 'qq', providerUserId: 'qq-1' },
          'en',
        ),
      ).resolves.toBeUndefined();
    });
  });
});
