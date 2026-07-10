import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { I18nService } from 'nestjs-i18n';
import { QqOAuthProvider } from './qq-oauth.provider';

jest.mock('../../../common/helpers/retry.utils', () => ({
  fetchWithRetry: jest.fn(),
  withRetry: jest.fn(),
}));

const { fetchWithRetry } = jest.requireMock(
  '../../../common/helpers/retry.utils',
) as { fetchWithRetry: jest.Mock };

describe('QqOAuthProvider', () => {
  let provider: QqOAuthProvider;
  let configService: jest.Mocked<ConfigService>;
  let i18n: jest.Mocked<I18nService>;

  const fullConfig = {
    qq: {
      appId: 'qq-app-id',
      appSecret: 'qq-app-secret',
      redirectUri: 'https://app/qq/callback',
    },
  };

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn().mockReturnValue(fullConfig),
    } as unknown as jest.Mocked<ConfigService>;
    i18n = {
      t: jest.fn().mockReturnValue('translated'),
    } as unknown as jest.Mocked<I18nService>;

    provider = new QqOAuthProvider(configService, i18n);
    fetchWithRetry.mockReset();
  });

  describe('buildAuthorizeUrl', () => {
    it('builds authorize URL with state', () => {
      const url = provider.buildAuthorizeUrl('test-state');

      expect(url).toContain('https://graph.qq.com/oauth2.0/authorize');
      expect(url).toContain('state=test-state');
      expect(url).toContain('client_id=qq-app-id');
      expect(url).toContain('redirect_uri=');
    });

    it('uses callbackUri when provided', () => {
      const url = provider.buildAuthorizeUrl('state', 'https://custom/cb');

      expect(url).toContain('redirect_uri=');
      expect(url).toContain('https%3A%2F%2Fcustom%2Fcb');
    });
  });

  describe('fetchProfile', () => {
    it('throws when code is missing', async () => {
      await expect(provider.fetchProfile({})).rejects.toThrow();
    });

    it('fetches profile through the full QQ OAuth flow', async () => {
      // Step 1: access token response (query string format)
      fetchWithRetry.mockResolvedValueOnce({
        text: jest
          .fn()
          .mockResolvedValue(
            'access_token=token123&expires_in=3600&refresh_token=rt456',
          ),
      });

      // Step 2: openid response (JSON)
      fetchWithRetry.mockResolvedValueOnce({
        text: jest
          .fn()
          .mockResolvedValue(
            JSON.stringify({ client_id: 'qq-app-id', openid: 'openid-123' }),
          ),
      });

      // Step 3: user info response
      fetchWithRetry.mockResolvedValueOnce({
        json: jest.fn().mockResolvedValue({
          ret: 0,
          msg: '',
          nickname: 'QQUser',
          figureurl_qq_2: 'https://qq/avatar.jpg',
          gender: 'male',
        }),
      });

      const profile = await provider.fetchProfile({ code: 'auth-code' });

      expect(profile.provider).toBe('qq');
      expect(profile.providerUserId).toBe('openid-123');
      expect(profile.nickname).toBe('QQUser');
      expect(profile.avatar).toBe('https://qq/avatar.jpg');
      expect(profile.email).toBeNull();
    });

    it('throws ServiceUnavailableException when fetchWithRetry fails', async () => {
      fetchWithRetry.mockRejectedValue(new Error('Network error'));

      await expect(
        provider.fetchProfile({ code: 'auth-code' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('onModuleInit', () => {
    it('warns when QQ OAuth is not fully configured', () => {
      configService.getOrThrow.mockReturnValue({
        qq: { appId: '', appSecret: '', redirectUri: '' },
      });

      // Should not throw, just warn
      expect(() => {
        provider.onModuleInit();
      }).not.toThrow();
    });

    it('does not warn when fully configured', () => {
      expect(() => {
        provider.onModuleInit();
      }).not.toThrow();
    });
  });
});
