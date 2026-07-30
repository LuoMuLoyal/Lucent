import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { I18nService } from 'nestjs-i18n';
import { WeiboOAuthProvider } from './weibo-oauth.provider';

import * as commonUtils from '../../../common';

vi.mock('../../../common', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    fetchWithRetry: vi.fn(),
    withRetry: vi.fn(),
  };
});

const { fetchWithRetry } = commonUtils as unknown as {
  fetchWithRetry: vi.Mock;
};

describe('WeiboOAuthProvider', () => {
  let provider: WeiboOAuthProvider;
  let configService: vi.Mocked<ConfigService>;
  let i18n: vi.Mocked<I18nService>;

  const fullConfig = {
    weibo: {
      appId: 'weibo-app-id',
      appSecret: 'weibo-app-secret',
      redirectUri: 'https://app/weibo/callback',
    },
  };

  beforeEach(() => {
    configService = {
      getOrThrow: vi.fn().mockReturnValue(fullConfig),
    } as unknown as vi.Mocked<ConfigService>;
    i18n = {
      t: vi.fn().mockReturnValue('translated'),
    } as unknown as vi.Mocked<I18nService>;

    provider = new WeiboOAuthProvider(configService, i18n);
    fetchWithRetry.mockReset();
  });

  describe('buildAuthorizeUrl', () => {
    it('builds authorize URL with state', () => {
      const url = provider.buildAuthorizeUrl('test-state');

      expect(url).toContain('https://api.weibo.com/oauth2/authorize');
      expect(url).toContain('state=test-state');
      expect(url).toContain('client_id=weibo-app-id');
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

    it('fetches profile through the full Weibo OAuth flow', async () => {
      // Step 1: access token response (JSON)
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          access_token: 'token123',
          expires_in: 3600,
          uid: 'uid-123',
        }),
      });

      // Step 2: user info response (JSON)
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          id: 123,
          idstr: '123',
          screen_name: 'WeiboUser',
          profile_image_url: 'https://weibo/avatar.jpg',
          avatar_large: 'https://weibo/avatar_large.jpg',
          gender: 'm',
        }),
      });

      const profile = await provider.fetchProfile({ code: 'auth-code' });

      expect(profile.provider).toBe('weibo');
      expect(profile.providerUserId).toBe('uid-123');
      expect(profile.nickname).toBe('WeiboUser');
      expect(profile.avatar).toBe('https://weibo/avatar_large.jpg');
      expect(profile.email).toBeNull();
    });

    it('throws ServiceUnavailableException when fetchWithRetry fails', async () => {
      fetchWithRetry.mockRejectedValue(new Error('Network error'));

      await expect(
        provider.fetchProfile({ code: 'auth-code' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws when token response has error', async () => {
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          error: 'invalid_grant',
          error_description: 'Bad code',
        }),
      });

      await expect(
        provider.fetchProfile({ code: 'bad-code' }),
      ).rejects.toThrow();
    });
  });

  describe('onModuleInit', () => {
    it('warns when Weibo OAuth is not fully configured', () => {
      configService.getOrThrow.mockReturnValue({
        weibo: { appId: '', appSecret: '', redirectUri: '' },
      });

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
