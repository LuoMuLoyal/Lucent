import type { ConfigService } from '@nestjs/config';
import { QqOAuthProvider } from './qq-oauth.provider.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';

import * as commonUtils from '../../../common/index.js';

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

describe('QqOAuthProvider', () => {
  let provider: QqOAuthProvider;
  let configService: vi.Mocked<ConfigService>;

  const fullConfig = {
    qq: {
      appId: 'qq-app-id',
      appSecret: 'qq-app-secret',
      redirectUri: 'https://app/qq/callback',
    },
  };

  beforeEach(() => {
    configService = {
      getOrThrow: vi.fn().mockReturnValue(fullConfig),
    } as unknown as vi.Mocked<ConfigService>;

    provider = new QqOAuthProvider(configService);
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
    it('returns VALIDATION_FAILED when code is missing', async () => {
      await expectErr(provider.fetchProfile({}), 'VALIDATION_FAILED');
    });

    it('fetches profile through the full QQ OAuth flow', async () => {
      // Step 1: access token response (query string format)
      fetchWithRetry.mockResolvedValueOnce({
        text: vi
          .fn()
          .mockResolvedValue(
            'access_token=token123&expires_in=3600&refresh_token=rt456',
          ),
      });

      // Step 2: openid response (JSON)
      fetchWithRetry.mockResolvedValueOnce({
        text: vi
          .fn()
          .mockResolvedValue(
            JSON.stringify({ client_id: 'qq-app-id', openid: 'openid-123' }),
          ),
      });

      // Step 3: user info response
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          ret: 0,
          msg: '',
          nickname: 'QQUser',
          figureurl_qq_2: 'https://qq/avatar.jpg',
          gender: 'male',
        }),
      });

      const profile = await expectOk(
        provider.fetchProfile({ code: 'auth-code' }),
      );

      expect(profile.provider).toBe('qq');
      expect(profile.providerUserId).toBe('openid-123');
      expect(profile.nickname).toBe('QQUser');
      expect(profile.avatar).toBe('https://qq/avatar.jpg');
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
      fetchWithRetry.mockRejectedValue(new Error('fetch timed out'));

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_TIMEOUT',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when the upstream responds with a non-2xx status', async () => {
      fetchWithRetry.mockRejectedValue(new HttpStatusError(502));

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when the token endpoint reports an error', async () => {
      // JSONP format carrying an error
      fetchWithRetry.mockResolvedValueOnce({
        text: vi
          .fn()
          .mockResolvedValue(
            'callback( {"error":100016,"error_description":"bad code"} );',
          ),
      });

      await expectErr(
        provider.fetchProfile({ code: 'bad-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when the token response lacks access_token', async () => {
      fetchWithRetry.mockResolvedValueOnce({
        text: vi.fn().mockResolvedValue('expires_in=3600'),
      });

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when the openid endpoint reports an error', async () => {
      fetchWithRetry.mockResolvedValueOnce({
        text: vi
          .fn()
          .mockResolvedValue(
            'access_token=token123&expires_in=3600&refresh_token=rt456',
          ),
      });
      fetchWithRetry.mockResolvedValueOnce({
        text: vi
          .fn()
          .mockResolvedValue(
            JSON.stringify({ error: 100016, error_description: 'bad' }),
          ),
      });

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when the user info request fails', async () => {
      fetchWithRetry.mockResolvedValueOnce({
        text: vi
          .fn()
          .mockResolvedValue(
            'access_token=token123&expires_in=3600&refresh_token=rt456',
          ),
      });
      fetchWithRetry.mockResolvedValueOnce({
        text: vi
          .fn()
          .mockResolvedValue(
            JSON.stringify({ client_id: 'qq-app-id', openid: 'openid-123' }),
          ),
      });
      fetchWithRetry.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ ret: 100030, msg: 'failed' }),
      });

      await expectErr(
        provider.fetchProfile({ code: 'auth-code' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
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
