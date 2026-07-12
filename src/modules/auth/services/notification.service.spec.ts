import type { NotificationsService } from '../../notifications/services/notifications.service';
import type { OAuthProfile } from '../types/oauth.types';
import { AuthNotificationService } from './notification.service';

describe('AuthNotificationService', () => {
  let service: AuthNotificationService;
  let notificationsService: vi.Mocked<NotificationsService>;

  beforeEach(() => {
    notificationsService = {
      create: vi.fn().mockResolvedValue(undefined),
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
});
