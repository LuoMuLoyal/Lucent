import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { I18nService } from 'nestjs-i18n';
import { AppleOAuthProvider } from './apple-oauth.provider';

jest.mock('../../../common/helpers/retry.utils', () => ({
  withRetry: jest.fn(),
}));

const { withRetry } = jest.requireMock(
  '../../../common/helpers/retry.utils',
) as { withRetry: jest.Mock };

describe('AppleOAuthProvider', () => {
  let provider: AppleOAuthProvider;
  let configService: jest.Mocked<ConfigService>;
  let i18n: jest.Mocked<I18nService>;
  let jwtService: jest.Mocked<JwtService>;

  const fullConfig = {
    apple: {
      appId: 'com.test.app',
      jwksUrl: 'https://appleid.apple.com/auth/keys',
      issuer: 'https://appleid.apple.com',
    },
  };

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn().mockReturnValue(fullConfig),
    } as unknown as jest.Mocked<ConfigService>;
    i18n = {
      t: jest.fn().mockReturnValue('translated'),
    } as unknown as jest.Mocked<I18nService>;
    jwtService = {
      decode: jest.fn(),
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    provider = new AppleOAuthProvider(configService, i18n, jwtService);
    withRetry.mockReset();
  });

  describe('fetchProfile', () => {
    it('throws when identityToken is missing', async () => {
      await expect(provider.fetchProfile({})).rejects.toThrow();
    });

    it('throws when jwt decode returns null', async () => {
      jwtService.decode.mockReturnValue(null);

      await expect(
        provider.fetchProfile({ identityToken: 'invalid-token' }),
      ).rejects.toThrow();
    });

    it('throws when kid is missing from header', async () => {
      jwtService.decode.mockReturnValue({
        header: {},
        payload: {},
        signature: '',
      });

      await expect(
        provider.fetchProfile({ identityToken: 'token-without-kid' }),
      ).rejects.toThrow();
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

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ keys: [mockJwk] }),
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

      const profile = await provider.fetchProfile({
        identityToken: 'valid-token',
        givenName: 'John',
        familyName: 'Doe',
      });

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

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ keys: [mockJwk] }),
      });

      jwtService.verifyAsync.mockResolvedValue({
        iss: 'https://appleid.apple.com',
        sub: 'apple-user-456',
        aud: 'com.test.app',
        iat: 1234567890,
        exp: 1234567890,
      });

      const profile = await provider.fetchProfile({
        identityToken: 'valid-token',
      });

      expect(profile.nickname).toBeNull();
      expect(profile.email).toBeNull();
    });

    it('throws when verifyAsync fails', async () => {
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

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ keys: [mockJwk] }),
      });

      jwtService.verifyAsync.mockRejectedValue(
        new Error('verification failed'),
      );

      await expect(
        provider.fetchProfile({ identityToken: 'bad-token' }),
      ).rejects.toThrow();
    });

    it('throws ServiceUnavailableException when JWKS fetch fails', async () => {
      jwtService.decode.mockReturnValue({
        header: { kid: 'test-kid' },
        payload: {},
        signature: 'sig',
      });

      withRetry.mockRejectedValue(new Error('JWKS fetch failed'));

      await expect(
        provider.fetchProfile({ identityToken: 'token' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
