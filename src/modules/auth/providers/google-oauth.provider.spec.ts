import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { I18nService } from 'nestjs-i18n';
import { GoogleOAuthProvider } from './google-oauth.provider';

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

describe('GoogleOAuthProvider', () => {
  let provider: GoogleOAuthProvider;
  let configService: vi.Mocked<ConfigService>;
  let i18n: vi.Mocked<I18nService>;

  const fullConfig = {
    google: {
      appId: 'google-client-id',
      appSecret: 'google-client-secret',
      redirectUri: 'https://app/google/callback',
    },
  };

  beforeEach(() => {
    configService = {
      getOrThrow: vi.fn().mockReturnValue(fullConfig),
    } as unknown as vi.Mocked<ConfigService>;
    i18n = {
      t: vi.fn().mockReturnValue('translated'),
    } as unknown as vi.Mocked<I18nService>;

    provider = new GoogleOAuthProvider(configService, i18n);
    fetchWithRetry.mockReset();
  });

  describe('buildAuthorizeUrl', () => {
    it('builds authorize URL with state and scope', () => {
      const url = provider.buildAuthorizeUrl('test-state');

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('state=test-state');
      expect(url).toContain('client_id=google-client-id');
      expect(url).toContain('scope=openid+email+profile');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
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

    it('fetches profile through the full Google OAuth flow', async () => {
      // Step 1: access token response (JSON)
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          access_token: 'token123',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      // Step 2: user info response (JSON)
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          sub: 'google-sub-123',
          email: 'user@gmail.com',
          email_verified: true,
          name: 'Google User',
          picture: 'https://google/avatar.jpg',
          locale: 'en',
        }),
      });

      const profile = await provider.fetchProfile({ code: 'auth-code' });

      expect(profile.provider).toBe('google');
      expect(profile.providerUserId).toBe('google-sub-123');
      expect(profile.email).toBe('user@gmail.com');
      expect(profile.emailVerifiedAt).toBeInstanceOf(Date);
      expect(profile.nickname).toBe('Google User');
      expect(profile.avatar).toBe('https://google/avatar.jpg');
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
    it('warns when Google OAuth is not fully configured', () => {
      configService.getOrThrow.mockReturnValue({
        google: { appId: '', appSecret: '', redirectUri: '' },
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
