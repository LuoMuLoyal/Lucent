import { nonDeleted } from '../../../common';

import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { I18nService } from 'nestjs-i18n';

import { AuthService } from './auth.service';
import { AuthSessionRepositoryPort } from '../repositories/session.repository';

import { AuthAccountRepositoryPort } from '../repositories/account.repository';
import { UserService } from '../../user';
import { VerificationCodeService } from './identity/verification-code.service';
import { AuthRateLimitService } from './identity/rate-limit.service';
import { AuthTokenService } from './token.service';
import { AuthOAuthStateService } from './oauth/state.service';
import { AuthOAuthService } from './oauth/oauth.service';
import { CredentialAuthService } from './identity/credential.service';
import { AuthAccountService } from './account.service';
import { AuthOAuthFacadeService } from './oauth/facade.service';
import { AuthNotificationService } from './notification.service';
import { UserStatus } from '#generated/prisma/client';
import { WechatMobileOAuthProvider } from '../providers/wechat/wechat-mobile-oauth.provider';
import { WechatWebOAuthProvider } from '../providers/wechat/wechat-web-oauth.provider';
import { AppleOAuthProvider } from '../providers/apple-oauth.provider';
import { QqOAuthProvider } from '../providers/qq-oauth.provider';
import { NotificationsService } from '../../notifications';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type ResultAsync,
} from '../../../common/result';

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(),
  verify: vi.fn(),
  Options: {},
}));

/**
 * Folds a ResultAsync into a plain outcome so specs can assert both success
 * values and DomainFailure codes without throwing.
 */
function collectResult<T, E>(
  result: ResultAsync<T, E>,
): Promise<{ ok: true; value: T } | { ok: false; error: E }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  emailVerified: true,
  nickname: 'TestUser',
  avatar: null,
  status: UserStatus.active,
  emailVerifiedAt: null,
  lastLoginAt: null,
  ...nonDeleted,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const mockJwtConfig = {
  accessSecret: 'test-access-secret',
  refreshSecret: 'test-refresh-secret',
  accessTtl: 900,
  refreshTtl: 1_209_600,
};

const mockRequestContext = {
  ipAddress: '203.0.113.10',
  userAgent: 'LuminousTest/1.0',
};

const mockTokenPair = {
  accessToken: 'mock-jwt-token',
  refreshToken: 'mock-refresh-token',
  accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString(),
  refreshTokenExpiresAt: new Date(Date.now() + 604800000).toISOString(),
};

describe('AuthService', () => {
  let service: AuthService;
  let authTokenService: vi.Mocked<AuthTokenService>;
  let authAccountService: vi.Mocked<AuthAccountService>;
  let authOAuthFacadeService: vi.Mocked<AuthOAuthFacadeService>;
  let credentialAuthService: vi.Mocked<CredentialAuthService>;
  let module: TestingModule;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: AuthSessionRepositoryPort,
          useValue: {},
        },
        {
          provide: AuthAccountRepositoryPort,
          useValue: {},
        },
        {
          provide: UserService,
          useValue: {
            findByEmail: vi.fn(),
            findById: vi.fn(),
            findByIdentity: vi.fn(),
            findByProviderUnionId: vi.fn(),
            create: vi.fn(),
            createOAuthUser: vi.fn(),
            linkIdentity: vi.fn(),
            update: vi.fn(),
            updateByEmail: vi.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { signAsync: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((_: string, defaultValue: unknown) => defaultValue),
            getOrThrow: vi.fn().mockReturnValue(mockJwtConfig),
          },
        },
        {
          provide: VerificationCodeService,
          useValue: {
            assertClientRateLimit: vi.fn(),
            send: vi.fn(),
            verify: vi.fn(),
            getCooldownSec: vi.fn().mockReturnValue(60),
          },
        },
        {
          provide: WechatMobileOAuthProvider,
          useValue: {
            fetchProfile: vi.fn(),
          },
        },
        {
          provide: WechatWebOAuthProvider,
          useValue: {
            buildAuthorizeUrl: vi.fn(),
            fetchProfile: vi.fn(),
          },
        },
        {
          provide: AppleOAuthProvider,
          useValue: {
            fetchProfile: vi.fn(),
          },
        },
        {
          provide: QqOAuthProvider,
          useValue: {
            buildAuthorizeUrl: vi.fn(),
            fetchProfile: vi.fn(),
          },
        },
        {
          provide: I18nService,
          useValue: { t: vi.fn((key: string) => key) },
        },
        // ── Sub-service mocks ──
        {
          provide: AuthRateLimitService,
          useValue: {
            checkLoginRateLimit: vi.fn().mockResolvedValue(undefined),
            recordLoginFailure: vi.fn(),
            clearLoginFailures: vi.fn(),
          },
        },
        {
          provide: AuthTokenService,
          useValue: {
            generateTokenPair: vi.fn().mockReturnValue(okAsync(mockTokenPair)),
            refresh: vi.fn().mockReturnValue(
              errAsync(
                createDomainFailure({
                  kind: 'authentication',
                  code: 'AUTH_REFRESH_TOKEN_INVALID',
                }),
              ),
            ),
            revoke: vi.fn().mockReturnValue(okAsync(undefined)),
            revokeAll: vi.fn().mockReturnValue(okAsync(undefined)),
            revokeById: vi.fn(),
            listSessions: vi.fn(),
            hashRefreshToken: vi.fn(),
          },
        },
        {
          provide: AuthOAuthStateService,
          useValue: {
            createState: vi.fn().mockResolvedValue({
              state: 'mock-oauth-state',
              ttlSec: 600,
              callbackUri: undefined,
            }),
            consume: vi.fn().mockResolvedValue({
              callbackUri: 'http://localhost:8080/callback',
              targetUrl: '/',
              purpose: 'login',
            }),
            peek: vi.fn().mockResolvedValue({
              callbackUri: 'http://localhost:8080/callback',
              targetUrl: '/',
              purpose: 'login',
              platform: 'web',
            }),
            buildRedirectUrl: vi
              .fn()
              .mockReturnValue(
                'http://localhost:8080/callback?code=mock-auth-code&state=mock-oauth-state',
              ),
          },
        },
        {
          provide: AuthOAuthService,
          useValue: {
            findOrCreateOAuthUser: vi.fn(),
            updateOAuthLoginUser: vi.fn(),
            linkOAuthProfileToUser: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            create: vi.fn(),
            findAll: vi.fn(),
            findOne: vi.fn(),
            markAsRead: vi.fn(),
            markAsUnread: vi.fn(),
            markAllAsRead: vi.fn(),
            remove: vi.fn(),
            getUnreadCount: vi.fn(),
          },
        },
        {
          provide: CredentialAuthService,
          useValue: {
            register: vi
              .fn()
              .mockReturnValue(okAsync({ user: mockUser, ...mockTokenPair })),
            login: vi
              .fn()
              .mockReturnValue(okAsync({ user: mockUser, ...mockTokenPair })),
            changePassword: vi.fn().mockReturnValue(okAsync(undefined)),
            setPassword: vi.fn().mockReturnValue(okAsync(undefined)),
            changeEmail: vi.fn().mockReturnValue(okAsync(mockUser)),
            sendVerificationCode: vi
              .fn()
              .mockReturnValue(okAsync({ message: 'verification_code_sent' })),
            verifyEmail: vi.fn().mockReturnValue(okAsync(undefined)),
            forgotPassword: vi
              .fn()
              .mockReturnValue(okAsync({ message: 'forgot_password_hint' })),
            resetPassword: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: AuthAccountService,
          useValue: {
            getActiveUser: vi.fn().mockReturnValue(okAsync(mockUser)),
            deleteAccount: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: AuthOAuthFacadeService,
          useValue: {
            createWechatWebAuthorizeUrl: vi.fn().mockReturnValue(
              okAsync({
                url: 'https://example.com/auth',
                state: 'mock-state',
              }),
            ),
            createWechatWebIdentityLinkAuthorizeUrl: vi.fn().mockReturnValue(
              okAsync({
                url: 'https://example.com/link',
                state: 'mock-state',
              }),
            ),
            resolveWechatWebCallbackRedirect: vi
              .fn()
              .mockReturnValue(okAsync('http://localhost:8080/callback')),
            loginWithWechatWeb: vi
              .fn()
              .mockReturnValue(okAsync({ user: mockUser, ...mockTokenPair })),
            loginWithWechatMobile: vi
              .fn()
              .mockReturnValue(okAsync({ user: mockUser, ...mockTokenPair })),
            loginWithApple: vi
              .fn()
              .mockReturnValue(okAsync({ user: mockUser, ...mockTokenPair })),
            createQqAuthorizeUrl: vi.fn().mockReturnValue(
              okAsync({
                url: 'https://example.com/qq/auth',
                state: 'mock-state',
              }),
            ),
            loginWithQq: vi
              .fn()
              .mockReturnValue(okAsync({ user: mockUser, ...mockTokenPair })),
            linkWechatWebIdentity: vi.fn().mockReturnValue(okAsync(undefined)),
            linkWechatMobileIdentity: vi
              .fn()
              .mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: AuthNotificationService,
          useValue: {
            notifyOAuthLogin: vi.fn().mockResolvedValue(undefined),
            notifyIdentityLinked: vi.fn().mockResolvedValue(undefined),
            providerLabel: vi.fn((provider: string) => provider),
          },
        },
      ],
    }).compile();

    module = moduleFixture;
    service = module.get(AuthService);
    authTokenService = module.get(AuthTokenService);
    authAccountService = module.get(AuthAccountService);
    authOAuthFacadeService = module.get(AuthOAuthFacadeService);
    credentialAuthService = module.get(CredentialAuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════
  // 1. Register
  // ══════════════════════════════════════════════════════════════
  // 3. Token Refresh
  // ══════════════════════════════════════════════════════════════

  describe('refresh', () => {
    it('should rotate refresh token and return a new pair', async () => {
      (authTokenService.refresh as vi.Mock).mockReturnValueOnce(
        okAsync(mockTokenPair),
      );

      const outcome = await collectResult(
        service.refresh('valid-token', mockRequestContext),
      );

      expect(authTokenService.refresh).toHaveBeenCalledWith(
        'valid-token',
        mockRequestContext,
      );
      expect(outcome).toEqual({ ok: true, value: mockTokenPair });
    });

    it('should return AUTH_REFRESH_TOKEN_INVALID for an invalid refresh token', async () => {
      const outcome = await collectResult(service.refresh('bad-token'));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
        }),
      });
    });

    it('should return AUTH_REFRESH_TOKEN_INVALID for an expired refresh token', async () => {
      (authTokenService.refresh as vi.Mock).mockReturnValueOnce(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_REFRESH_TOKEN_INVALID',
          }),
        ),
      );

      const outcome = await collectResult(service.refresh('expired-token'));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
        }),
      });
    });

    it('should not mask infrastructure failures as refresh-token-invalid', async () => {
      (authTokenService.refresh as vi.Mock).mockReturnValueOnce(
        fromPromise(
          Promise.reject(new Error('db connection lost')),
          (error) => {
            throw error;
          },
        ),
      );

      await expect(collectResult(service.refresh('token'))).rejects.toThrow(
        'db connection lost',
      );
    });

    it('should not mask signing failures as refresh-token-invalid', async () => {
      (authTokenService.refresh as vi.Mock).mockReturnValueOnce(
        fromPromise(
          Promise.reject(new InternalServerErrorException('signing failed')),
          (error) => {
            throw error;
          },
        ),
      );

      await expect(collectResult(service.refresh('token'))).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 4. Logout
  // ══════════════════════════════════════════════════════════════

  describe('logout', () => {
    it('should delegate to authTokenService.revoke', async () => {
      const outcome = await collectResult(
        service.logout('user-uuid-1', 'some-refresh-token'),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(authTokenService.revoke).toHaveBeenCalledWith(
        'user-uuid-1',
        'some-refresh-token',
      );
    });
  });

  describe('logoutAll', () => {
    it('should delegate to authTokenService.revokeAll', async () => {
      const outcome = await collectResult(service.logoutAll('user-uuid-1'));

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-uuid-1');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 5. Profile Management
  // ══════════════════════════════════════════════════════════════

  describe('getActiveUser', () => {
    it('should delegate to authAccountService.getActiveUser', async () => {
      authAccountService.getActiveUser.mockReturnValue(okAsync(mockUser));

      const outcome = await collectResult(service.getActiveUser('user-uuid-1'));

      expect(authAccountService.getActiveUser).toHaveBeenCalledWith(
        'user-uuid-1',
      );
      expect(outcome).toEqual({ ok: true, value: mockUser });
    });

    it('should propagate RESOURCE_NOT_FOUND from authAccountService.getActiveUser', async () => {
      authAccountService.getActiveUser.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'not_found',
            code: 'RESOURCE_NOT_FOUND',
          }),
        ),
      );

      const outcome = await collectResult(service.getActiveUser('user-uuid-1'));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
      });
    });
  });

  describe('deleteAccount', () => {
    it('should delegate to authAccountService.deleteAccount', async () => {
      authAccountService.deleteAccount.mockReturnValue(okAsync(undefined));

      const outcome = await collectResult(
        service.deleteAccount('user-uuid-1', {
          password: 'Password123!',
        }),
      );

      expect(authAccountService.deleteAccount).toHaveBeenCalledWith(
        'user-uuid-1',
        { password: 'Password123!' },
      );
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should propagate AUTH_WRONG_PASSWORD from authAccountService.deleteAccount', async () => {
      authAccountService.deleteAccount.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_WRONG_PASSWORD',
          }),
        ),
      );

      const outcome = await collectResult(
        service.deleteAccount('user-uuid-1', { password: 'wrong' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_WRONG_PASSWORD' }),
      });
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 6. Email Verification & Password Reset
  // ══════════════════════════════════════════════════════════════

  describe('credential delegation', () => {
    it('should delegate register to credentialAuthService', async () => {
      const dto = { email: 'a@b.c', password: 'Password123!' } as never;
      await service.register(dto, mockRequestContext);
      expect(credentialAuthService.register).toHaveBeenCalledWith(
        dto,
        mockRequestContext,
      );
    });

    it('should delegate login to credentialAuthService', async () => {
      const dto = { email: 'a@b.c', password: 'Password123!' } as never;
      await service.login(dto, mockRequestContext);
      expect(credentialAuthService.login).toHaveBeenCalledWith(
        dto,
        mockRequestContext,
      );
    });

    it('should delegate password and email operations', async () => {
      const changePassword = {
        currentPassword: 'a',
        newPassword: 'b',
      } as never;
      await service.changePassword('u1', changePassword);
      expect(credentialAuthService.changePassword).toHaveBeenCalledWith(
        'u1',
        changePassword,
      );

      const setPassword = { newPassword: 'b' } as never;
      await service.setPassword('u1', setPassword);
      expect(credentialAuthService.setPassword).toHaveBeenCalledWith(
        'u1',
        setPassword,
      );

      const changeEmail = { email: 'new@b.c' } as never;
      await service.changeEmail('u1', changeEmail);
      expect(credentialAuthService.changeEmail).toHaveBeenCalledWith(
        'u1',
        changeEmail,
      );
    });

    it('should delegate verification and reset flows', async () => {
      await service.sendVerificationCode({ email: 'a@b.c' } as never, 'key');
      expect(credentialAuthService.sendVerificationCode).toHaveBeenCalledWith(
        { email: 'a@b.c' },
        'key',
      );

      await service.verifyEmail({ code: '123456' } as never);
      expect(credentialAuthService.verifyEmail).toHaveBeenCalledWith({
        code: '123456',
      });

      await service.forgotPassword({ email: 'a@b.c' } as never, 'key');
      expect(credentialAuthService.forgotPassword).toHaveBeenCalledWith(
        { email: 'a@b.c' },
        'key',
      );

      await service.resetPassword({ code: '123456' } as never);
      expect(credentialAuthService.resetPassword).toHaveBeenCalledWith({
        code: '123456',
      });
    });
  });

  describe('OAuth facade delegation', () => {
    const mockDto = { code: 'mock-auth-code', state: 'mock-oauth-state' };

    it('should delegate createWechatWebAuthorizeUrl to authOAuthFacadeService', async () => {
      const outcome = await collectResult(
        service.createWechatWebAuthorizeUrl(),
      );

      expect(
        authOAuthFacadeService.createWechatWebAuthorizeUrl,
      ).toHaveBeenCalled();
      expect(outcome).toEqual({
        ok: true,
        value: { url: 'https://example.com/auth', state: 'mock-state' },
      });
    });

    it('should pass callbackUri to authOAuthFacadeService', async () => {
      await service.createWechatWebAuthorizeUrl({
        callbackUri: 'http://localhost:8080/callback',
      });

      expect(
        authOAuthFacadeService.createWechatWebAuthorizeUrl,
      ).toHaveBeenCalledWith({
        callbackUri: 'http://localhost:8080/callback',
      });
    });

    it('should delegate resolveWechatWebCallbackRedirect to authOAuthFacadeService', async () => {
      const outcome = await collectResult(
        service.resolveWechatWebCallbackRedirect(mockDto),
      );

      expect(
        authOAuthFacadeService.resolveWechatWebCallbackRedirect,
      ).toHaveBeenCalledWith(mockDto);
      expect(outcome).toEqual({
        ok: true,
        value: 'http://localhost:8080/callback',
      });
    });

    it('should delegate loginWithWechatWeb to authOAuthFacadeService', async () => {
      const outcome = await collectResult(
        service.loginWithWechatWeb(mockDto, mockRequestContext),
      );

      expect(authOAuthFacadeService.loginWithWechatWeb).toHaveBeenCalledWith(
        mockDto,
        mockRequestContext,
      );
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ accessToken: 'mock-jwt-token' }),
      });
    });

    it('should propagate a DomainFailure from authOAuthFacadeService.loginWithWechatWeb', async () => {
      (
        authOAuthFacadeService.loginWithWechatWeb as vi.Mock
      ).mockReturnValueOnce(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_OAUTH_STATE_INVALID',
          }),
        ),
      );

      const outcome = await collectResult(
        service.loginWithWechatWeb({ code: 'x', state: 'bad' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_OAUTH_STATE_INVALID' }),
      });
    });

    it('should delegate linkWechatWebIdentity to authOAuthFacadeService', async () => {
      await service.linkWechatWebIdentity('user-uuid-1', mockDto);

      expect(authOAuthFacadeService.linkWechatWebIdentity).toHaveBeenCalledWith(
        'user-uuid-1',
        mockDto,
      );
    });

    it('should delegate linkWechatMobileIdentity to authOAuthFacadeService', async () => {
      await service.linkWechatMobileIdentity('user-uuid-1', {
        code: 'mock-mobile-code',
      });

      expect(
        authOAuthFacadeService.linkWechatMobileIdentity,
      ).toHaveBeenCalledWith('user-uuid-1', { code: 'mock-mobile-code' });
    });

    it('should delegate createWechatWebIdentityLinkAuthorizeUrl to authOAuthFacadeService', async () => {
      const outcome = await collectResult(
        service.createWechatWebIdentityLinkAuthorizeUrl(),
      );

      expect(
        authOAuthFacadeService.createWechatWebIdentityLinkAuthorizeUrl,
      ).toHaveBeenCalled();
      expect(outcome).toEqual({
        ok: true,
        value: { url: 'https://example.com/link', state: 'mock-state' },
      });
    });

    it('should delegate loginWithWechatMobile to authOAuthFacadeService', async () => {
      const dto = { code: 'mock-mobile-code' };
      const outcome = await collectResult(
        service.loginWithWechatMobile(dto, mockRequestContext),
      );

      expect(authOAuthFacadeService.loginWithWechatMobile).toHaveBeenCalledWith(
        dto,
        mockRequestContext,
      );
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ accessToken: 'mock-jwt-token' }),
      });
    });

    it('should delegate loginWithApple to authOAuthFacadeService', async () => {
      const dto = { identityToken: 'mock-apple-token' };
      const outcome = await collectResult(
        service.loginWithApple(dto, mockRequestContext),
      );

      expect(authOAuthFacadeService.loginWithApple).toHaveBeenCalledWith(
        dto,
        mockRequestContext,
      );
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ accessToken: 'mock-jwt-token' }),
      });
    });

    it('should delegate createQqAuthorizeUrl to authOAuthFacadeService', async () => {
      const outcome = await collectResult(service.createQqAuthorizeUrl());

      expect(authOAuthFacadeService.createQqAuthorizeUrl).toHaveBeenCalled();
      expect(outcome).toEqual({
        ok: true,
        value: { url: 'https://example.com/qq/auth', state: 'mock-state' },
      });
    });

    it('should delegate loginWithQq to authOAuthFacadeService', async () => {
      const dto = { code: 'mock-qq-code', state: 'mock-qq-state' };
      const outcome = await collectResult(
        service.loginWithQq(dto, mockRequestContext),
      );

      expect(authOAuthFacadeService.loginWithQq).toHaveBeenCalledWith(
        dto,
        mockRequestContext,
      );
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ accessToken: 'mock-jwt-token' }),
      });
    });
  });
});
