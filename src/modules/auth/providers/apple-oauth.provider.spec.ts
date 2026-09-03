import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { AppleOAuthProvider } from './apple-oauth.provider.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';

import * as commonUtils from '../../../common/index.js';

vi.mock('../../../common', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    withRetry: vi.fn(),
  };
});

const { withRetry } = commonUtils as unknown as { withRetry: vi.Mock };

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

describe('AppleOAuthProvider', () => {
  let provider: AppleOAuthProvider;
  let configService: vi.Mocked<ConfigService>;
  let jwtService: vi.Mocked<JwtService>;

  const fullConfig = {
    apple: {
      appId: 'com.test.app',
      jwksUrl: 'https://appleid.apple.com/auth/keys',
      issuer: 'https://appleid.apple.com',
    },
  };

  beforeEach(() => {
    configService = {
      getOrThrow: vi.fn().mockReturnValue(fullConfig),
    } as unknown as vi.Mocked<ConfigService>;
    jwtService = {
      decode: vi.fn(),
      verifyAsync: vi.fn(),
    } as unknown as vi.Mocked<JwtService>;

    provider = new AppleOAuthProvider(configService, jwtService);
    withRetry.mockReset();
  });

  describe('fetchProfile', () => {
    it('returns VALIDATION_FAILED when identityToken is missing', async () => {
      await expectErr(provider.fetchProfile({}), 'VALIDATION_FAILED');
    });

    it('returns VALIDATION_FAILED when jwt decode returns null', async () => {
      jwtService.decode.mockReturnValue(null);

      await expectErr(
        provider.fetchProfile({ identityToken: 'invalid-token' }),
        'VALIDATION_FAILED',
      );
    });

    it('returns VALIDATION_FAILED when kid is missing from header', async () => {
      jwtService.decode.mockReturnValue({
        header: {},
        payload: {},
        signature: '',
      });

      await expectErr(
        provider.fetchProfile({ identityToken: 'token-without-kid' }),
        'VALIDATION_FAILED',
      );
    });
  });

  describe('onModuleInit', () => {
    it('warns when Apple OAuth is not configured', () => {
      configService.getOrThrow.mockReturnValue({
        apple: { appId: '', jwksUrl: '', issuer: '' },
      });

      expect(() => {
        provider.onModuleInit();
      }).not.toThrow();
    });

    it('does not warn when configured', () => {
      expect(() => {
        provider.onModuleInit();
      }).not.toThrow();
    });
  });

  describe('fetchProfile with valid token', () => {
    it('returns profile with email and nickname', async () => {
      const mockJwk = {
        kty: 'RSA',
        kid: 'test-kid',
        use: 'sig',
        alg: 'RS256',
        n: 'test-n',
        e: 'AQAB',
      };

      jwtService.decode.mockReturnValue({
        header: { kid: 'test-kid', alg: 'RS256' },
        payload: {},
        signature: 'sig',
      });

      // Mock withRetry to return a response with Apple JWKS
      withRetry.mockImplementation(async (fn: () => Promise<unknown>) => {
        return fn();
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ keys: [mockJwk] }),
      });

      jwtService.verifyAsync.mockResolvedValue({
        iss: 'https://appleid.apple.com',
        sub: 'apple-user-123',
        aud: 'com.test.app',
        iat: 1234567890,
        exp: 1234567890,
        email: 'user@privaterelay.appleid.com',
        email_verified: 'true',
        is_private_email: true,
      });

      const profile = await expectOk(
        provider.fetchProfile({
          identityToken: 'valid-token',
          givenName: 'John',
          familyName: 'Doe',
        }),
      );

      expect(profile.provider).toBe('apple');
      expect(profile.providerUserId).toBe('apple-user-123');
      expect(profile.email).toBe('user@privaterelay.appleid.com');
      expect(profile.nickname).toBe('John Doe');
    });

    it('returns null nickname when givenName and familyName are absent', async () => {
      const mockJwk = {
        kty: 'RSA',
        kid: 'test-kid',
        use: 'sig',
        alg: 'RS256',
        n: 'test-n',
        e: 'AQAB',
      };

      jwtService.decode.mockReturnValue({
        header: { kid: 'test-kid' },
        payload: {},
        signature: 'sig',
      });

      withRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ keys: [mockJwk] }),
      });

      jwtService.verifyAsync.mockResolvedValue({
        iss: 'https://appleid.apple.com',
        sub: 'apple-user-456',
        aud: 'com.test.app',
        iat: 1234567890,
        exp: 1234567890,
      });

      const profile = await expectOk(
        provider.fetchProfile({
          identityToken: 'valid-token',
        }),
      );

      expect(profile.nickname).toBeNull();
      expect(profile.email).toBeNull();
    });

    it('returns VALIDATION_FAILED when verifyAsync fails', async () => {
      const mockJwk = {
        kty: 'RSA',
        kid: 'test-kid',
        use: 'sig',
        alg: 'RS256',
        n: 'test-n',
        e: 'AQAB',
      };

      jwtService.decode.mockReturnValue({
        header: { kid: 'test-kid' },
        payload: {},
        signature: 'sig',
      });

      withRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ keys: [mockJwk] }),
      });

      jwtService.verifyAsync.mockRejectedValue(
        new Error('verification failed'),
      );

      await expectErr(
        provider.fetchProfile({ identityToken: 'bad-token' }),
        'VALIDATION_FAILED',
      );
    });

    it('returns DEPENDENCY_UNAVAILABLE when JWKS fetch fails', async () => {
      jwtService.decode.mockReturnValue({
        header: { kid: 'test-kid' },
        payload: {},
        signature: 'sig',
      });

      withRetry.mockRejectedValue(new Error('JWKS fetch failed'));

      await expectErr(
        provider.fetchProfile({ identityToken: 'token' }),
        'DEPENDENCY_UNAVAILABLE',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when the JWKS fetch responds with a non-2xx status', async () => {
      jwtService.decode.mockReturnValue({
        header: { kid: 'test-kid' },
        payload: {},
        signature: 'sig',
      });

      withRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      await expectErr(
        provider.fetchProfile({ identityToken: 'token' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });

    it('returns DEPENDENCY_TIMEOUT when the JWKS fetch times out', async () => {
      jwtService.decode.mockReturnValue({
        header: { kid: 'test-kid' },
        payload: {},
        signature: 'sig',
      });

      const timeoutError = new Error('request timed out');
      timeoutError.name = 'TimeoutError';
      withRetry.mockRejectedValue(timeoutError);

      await expectErr(
        provider.fetchProfile({ identityToken: 'token' }),
        'DEPENDENCY_TIMEOUT',
      );
    });

    it('returns DEPENDENCY_BAD_GATEWAY when no JWK matches the kid', async () => {
      jwtService.decode.mockReturnValue({
        header: { kid: 'unknown-kid' },
        payload: {},
        signature: 'sig',
      });

      withRetry.mockImplementation(async (fn: () => Promise<unknown>) => fn());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ keys: [] }),
      });

      await expectErr(
        provider.fetchProfile({ identityToken: 'token' }),
        'DEPENDENCY_BAD_GATEWAY',
      );
    });
  });
});
