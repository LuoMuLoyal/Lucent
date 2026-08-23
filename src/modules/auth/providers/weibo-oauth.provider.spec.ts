import type { ConfigService } from '@nestjs/config';
import { WeiboOAuthProvider } from './weibo-oauth.provider';
import type { DomainFailure, ResultAsync } from '../../../common/result';

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
const { HttpStatusError } = commonUtils as unknown as {
  HttpStatusError: new (status: number) => Error;
};

async function expectOk<T>(result: ResultAsync<T, DomainFailure>): Promise<T> {
  const outcome = await result;
  expect(outcome.isOk()).toBe(true);
  if (outcome.isErr()) throw new Error(`Unexpected Err: ${outcome.error.code}`);
  return outcome.value;
}

async function expectErr(
  result: ResultAsync<unknown, DomainFailure>,
  code: string,
): Promise<void> {
  const outcome = await result;
  expect(outcome.isErr()).toBe(true);
  if (outcome.isOk()) throw new Error('Unexpected Ok');
  expect(outcome.error.code).toBe(code);
}

describe('WeiboOAuthProvider', () => {
  let provider: WeiboOAuthProvider;
  let configService: vi.Mocked<ConfigService>;

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

    provider = new WeiboOAuthProvider(configService);
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
    it('returns VALIDATION_FAILED when code is missing', async () => {
      await expectErr(provider.fetchProfile({}), 'VALIDATION_FAILED');
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

      const profile = await expectOk(
        provider.fetchProfile({ code: 'auth-code' }),
      );

      expect(profile.provider).toBe('weibo');
      expect(profile.providerUserId).toBe('uid-123');
      expect(profile.nickname).toBe('WeiboUser');
      expect(profile.avatar).toBe('https://weibo/avatar_large.jpg');
      expect(profile.email).toBeNull();
    });

    it('returns DEPENDENCY_UNAVAILABLE when fetchWithRetry fails', async () => {
      fetchWithRetry.mockRejectedValue(new Error('Network error'));

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_UNAVAILABLE',
      );
    });

    it('returns DEPENDENCY_TIMEOUT when the upstream call times out', async () => {
      fetchWithRetry.mockRejectedValue(new Error('timed out'));

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_TIMEOUT',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when the upstream responds with a non-2xx status', async () => {
      fetchWithRetry.mockRejectedValue(new HttpStatusError(500));

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when token response has error', async () => {
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          error: 'invalid_grant',
          error_description: 'Bad code',
        }),
      });

      await expectErr(
        provider.fetchProfile({ code: 'bad-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when token response lacks uid', async () => {
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          access_token: 'token123',
          expires_in: 3600,
        }),
      });

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when user info has error', async () => {
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          access_token: 'token123',
          expires_in: 3600,
          uid: 'uid-123',
        }),
      });
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          error: 'expired_token',
          error_code: 21332,
        }),
      });

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
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
