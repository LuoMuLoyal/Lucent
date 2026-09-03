import { errAsync, okAsync } from '../../../common/result/index.js';
import { createDomainFailure } from '../../../common/result/index.js';
import type { NotificationsService } from '../../notifications/index.js';
import type { OAuthProfile } from '../types/oauth.types.js';
import { AuthNotificationService } from './notification.service.js';

describe('AuthNotificationService', () => {
  let service: AuthNotificationService;
  let notificationsService: vi.Mocked<NotificationsService>;

  beforeEach(() => {
    notificationsService = {
      create: vi.fn().mockReturnValue(okAsync({} as never)),
    } as unknown as vi.Mocked<NotificationsService>;

    service = new AuthNotificationService(notificationsService);
  });

  describe('notifyOAuthLogin', () => {
    it('creates a notification with provider label', async () => {
      const profile: OAuthProfile = {
        provider: 'wechat_web',
        providerUserId: 'wx-123',
        nickname: 'TestUser',
      };

      await service.notifyOAuthLogin('user-1', profile);

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

    it('uses Apple label for apple provider', async () => {
      const profile: OAuthProfile = {
        provider: 'apple',
        providerUserId: 'apple-123',
      };

      await service.notifyOAuthLogin('user-1', profile);

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          content: expect.stringContaining('Apple'),
        }),
      );
    });

    it('uses QQ label for qq provider', async () => {
      const profile: OAuthProfile = {
        provider: 'qq',
        providerUserId: 'qq-123',
      };

      await service.notifyOAuthLogin('user-1', profile);

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          content: expect.stringContaining('QQ'),
        }),
      );
    });

    it('falls back to raw provider name for unknown providers', async () => {
      const profile: OAuthProfile = {
        provider: 'unknown_provider' as never,
        providerUserId: 'x',
      };

      await service.notifyOAuthLogin('user-1', profile);

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          content: expect.stringContaining('unknown_provider'),
        }),
      );
    });

    it('uses wechat_mobile label for wechat_mobile provider', async () => {
      const profile: OAuthProfile = {
        provider: 'wechat_mobile',
        providerUserId: 'wx-mobile',
      };

      await service.notifyOAuthLogin('user-1', profile);

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          content: expect.stringContaining('微信'),
        }),
      );
    });
  });

  describe('notifyIdentityLinked', () => {
    it('creates a notification with binding message', async () => {
      const profile: OAuthProfile = {
        provider: 'wechat_mobile',
        providerUserId: 'wx-456',
      };

      await service.notifyIdentityLinked('user-1', profile);

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          type: 'identity_linked',
          title: '账户绑定提醒',
          content: expect.stringContaining('微信'),
        }),
      );
    });

    it('uses Apple label for apple provider binding', async () => {
      const profile: OAuthProfile = {
        provider: 'apple',
        providerUserId: 'apple-456',
      };

      await service.notifyIdentityLinked('user-1', profile);

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          content: expect.stringContaining('Apple'),
        }),
      );
    });

    it('uses QQ label for qq provider binding', async () => {
      const profile: OAuthProfile = {
        provider: 'qq',
        providerUserId: 'qq-456',
      };

      await service.notifyIdentityLinked('user-1', profile);

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          content: expect.stringContaining('QQ'),
        }),
      );
    });

    it('falls back to raw provider name for unknown provider binding', async () => {
      const profile: OAuthProfile = {
        provider: 'github' as never,
        providerUserId: 'gh-1',
      };

      await service.notifyIdentityLinked('user-1', profile);

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          content: expect.stringContaining('github'),
        }),
      );
    });
  });

  describe('best-effort failure handling', () => {
    it('does not propagate a DomainFailure Err from the notification write', async () => {
      notificationsService.create.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'internal',
            code: 'INTERNAL_ERROR',
          }),
        ),
      );

      await expect(
        service.notifyOAuthLogin('user-1', {
          provider: 'qq',
          providerUserId: 'qq-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('does not propagate a rejected notification write', async () => {
      notificationsService.create.mockRejectedValue(
        new Error('db connection lost'),
      );

      await expect(
        service.notifyIdentityLinked('user-1', {
          provider: 'apple',
          providerUserId: 'apple-1',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
