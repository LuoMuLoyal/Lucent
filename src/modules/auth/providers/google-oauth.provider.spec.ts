import type { ConfigService } from '@nestjs/config';
import { GoogleOAuthProvider } from './google-oauth.provider';
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

describe('GoogleOAuthProvider', () => {
  let provider: GoogleOAuthProvider;
  let configService: vi.Mocked<ConfigService>;

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

    provider = new GoogleOAuthProvider(configService);
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
    it('returns VALIDATION_FAILED when code is missing', async () => {
      await expectErr(provider.fetchProfile({}), 'VALIDATION_FAILED');
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

      const profile = await expectOk(
        provider.fetchProfile({ code: 'auth-code' }),
      );

      expect(profile.provider).toBe('google');
      expect(profile.providerUserId).toBe('google-sub-123');
      expect(profile.email).toBe('user@gmail.com');
      expect(profile.emailVerifiedAt).toBeInstanceOf(Date);
      expect(profile.nickname).toBe('Google User');
      expect(profile.avatar).toBe('https://google/avatar.jpg');
    });

    it('returns DEPENDENCY_UNAVAILABLE when fetchWithRetry fails', async () => {
      fetchWithRetry.mockRejectedValue(new Error('Network error'));

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_UNAVAILABLE',
      );
    });

    it('returns DEPENDENCY_TIMEOUT when the upstream call times out', async () => {
      fetchWithRetry.mockRejectedValue(
        new Error('fetch timed out after 5000ms'),
      );

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_TIMEOUT',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when the upstream responds with a non-2xx status', async () => {
      fetchWithRetry.mockRejectedValue(new HttpStatusError(503));

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

    it('returns DEPENDENCY_BAD_GATEWAY when token response lacks access_token', async () => {
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ expires_in: 3600 }),
      });

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when user info lacks sub', async () => {
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          access_token: 'token123',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ email: 'user@gmail.com' }),
      });

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when the JSON body cannot be decoded', async () => {
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
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
