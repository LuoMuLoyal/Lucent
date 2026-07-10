import { nonDeleted } from '../../common/helpers/prisma.helpers';

import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PinoLogger } from 'nestjs-pino';
import { I18nService } from 'nestjs-i18n';

import { AuthService } from './services/auth.service';
import {
  AuthSessionRepositoryPort,
  AuthAccountRepositoryPort,
} from './repositories';
import { UserService } from '../user/services/user.service';
import { VerificationCodeService } from './services/verification-code.service';
import { AuthRateLimitService } from './services/rate-limit.service';
import { AuthTokenService } from './services/token.service';
import { AuthOAuthStateService } from './services/oauth/state.service';
import { AuthOAuthService } from './services/oauth/oauth.service';
import { CredentialAuthService } from './services/credential.service';
import { AuthAccountService } from './services/account.service';
import { AuthOAuthFacadeService } from './services/oauth/facade.service';
import { AuthNotificationService } from './services/notification.service';
import { UserStatus } from '#generated/prisma/client';
import { WechatMobileOAuthProvider } from './providers/wechat-mobile-oauth.provider';
import { WechatWebOAuthProvider } from './providers/wechat-web-oauth.provider';
import { AppleOAuthProvider } from './providers/apple-oauth.provider';
import { QqOAuthProvider } from './providers/qq-oauth.provider';
import { NotificationsService } from '../notifications/services/notifications.service';

jest.mock('argon2', () => ({
  argon2id: 2,
  hash: jest.fn(),
  verify: jest.fn(),
  Options: {},
}));

const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  passwordHash: '$argon2id$mock',
  nickname: 'TestUser',
  avatar: null,
  status: UserStatus.active,
  emailVerifiedAt: null,
  lastLoginAt: null,
  securityPinEnabled: false,
  securityPinHash: null,
  securityPinChangedAt: null,
  securityElevationVersion: 0,
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
  let authTokenService: jest.Mocked<AuthTokenService>;
  let authAccountService: jest.Mocked<AuthAccountService>;
  let authOAuthFacadeService: jest.Mocked<AuthOAuthFacadeService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            debug: jest.fn(),
          },
        },
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
            findByEmail: jest.fn(),
            findById: jest.fn(),
            findByIdentity: jest.fn(),
            findByProviderUnionId: jest.fn(),
            create: jest.fn(),
            createOAuthUser: jest.fn(),
            linkIdentity: jest.fn(),
            update: jest.fn(),
            updateByEmail: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_: string, defaultValue: unknown) => defaultValue),
            getOrThrow: jest.fn().mockReturnValue(mockJwtConfig),
          },
        },
        {
          provide: VerificationCodeService,
          useValue: {
            assertClientRateLimit: jest.fn(),
            send: jest.fn(),
            verify: jest.fn(),
            getCooldownSec: jest.fn().mockReturnValue(60),
          },
        },
        {
          provide: WechatMobileOAuthProvider,
          useValue: {
            fetchProfile: jest.fn(),
          },
        },
        {
          provide: WechatWebOAuthProvider,
          useValue: {
            buildAuthorizeUrl: jest.fn(),
            fetchProfile: jest.fn(),
          },
        },
        {
          provide: AppleOAuthProvider,
          useValue: {
            fetchProfile: jest.fn(),
          },
        },
        {
          provide: QqOAuthProvider,
          useValue: {
            buildAuthorizeUrl: jest.fn(),
            fetchProfile: jest.fn(),
          },
        },
        {
          provide: I18nService,
          useValue: { t: jest.fn((key: string) => key) },
        },
        // ── Sub-service mocks ──
        {
          provide: AuthRateLimitService,
          useValue: {
            checkLoginRateLimit: jest.fn().mockResolvedValue(undefined),
            recordLoginFailure: jest.fn(),
            clearLoginFailures: jest.fn(),
          },
        },
        {
          provide: AuthTokenService,
          useValue: {
            generateTokenPair: jest.fn().mockResolvedValue(mockTokenPair),
            refresh: jest
              .fn()
              .mockRejectedValue(new Error('REFRESH_TOKEN_INVALID')),
            revoke: jest.fn(),
            revokeAll: jest.fn(),
            revokeById: jest.fn(),
            listSessions: jest.fn(),
            hashRefreshToken: jest.fn(),
          },
        },
        {
          provide: AuthOAuthStateService,
          useValue: {
            createState: jest.fn().mockResolvedValue({
              state: 'mock-oauth-state',
              ttlSec: 600,
              callbackUri: undefined,
            }),
            consume: jest.fn().mockResolvedValue({
              callbackUri: 'http://localhost:8080/callback',
              targetUrl: '/',
              purpose: 'login',
            }),
            peek: jest.fn().mockResolvedValue({
              callbackUri: 'http://localhost:8080/callback',
              targetUrl: '/',
              purpose: 'login',
              platform: 'web',
            }),
            buildRedirectUrl: jest
              .fn()
              .mockReturnValue(
                'http://localhost:8080/callback?code=mock-auth-code&state=mock-oauth-state',
              ),
          },
        },
        {
          provide: AuthOAuthService,
          useValue: {
            findOrCreateOAuthUser: jest.fn(),
            updateOAuthLoginUser: jest.fn(),
            linkOAuthProfileToUser: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            markAsRead: jest.fn(),
            markAsUnread: jest.fn(),
            markAllAsRead: jest.fn(),
            remove: jest.fn(),
            getUnreadCount: jest.fn(),
          },
        },
        {
          provide: CredentialAuthService,
          useValue: {
            register: jest
              .fn()
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            login: jest
              .fn()
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            changePassword: jest.fn().mockResolvedValue(undefined),
            setPassword: jest.fn().mockResolvedValue(undefined),
            changeEmail: jest.fn().mockResolvedValue(mockUser),
            sendVerificationCode: jest
              .fn()
              .mockResolvedValue({ message: 'verification_code_sent' }),
            verifyEmail: jest.fn().mockResolvedValue(undefined),
            forgotPassword: jest
              .fn()
              .mockResolvedValue({ message: 'forgot_password_hint' }),
            resetPassword: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuthAccountService,
          useValue: {
            getActiveUser: jest.fn().mockResolvedValue(mockUser),
            deleteAccount: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuthOAuthFacadeService,
          useValue: {
            createWechatWebAuthorizeUrl: jest.fn().mockResolvedValue({
              url: 'https://example.com/auth',
              state: 'mock-state',
            }),
            createWechatWebIdentityLinkAuthorizeUrl: jest
              .fn()
              .mockResolvedValue({
                url: 'https://example.com/link',
                state: 'mock-state',
              }),
            resolveWechatWebCallbackRedirect: jest
              .fn()
              .mockResolvedValue('http://localhost:8080/callback'),
            loginWithWechatWeb: jest
              .fn()
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            loginWithWechatMobile: jest
              .fn()
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            loginWithApple: jest
              .fn()
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            createQqAuthorizeUrl: jest.fn().mockResolvedValue({
              url: 'https://example.com/qq/auth',
              state: 'mock-state',
            }),
            loginWithQq: jest
              .fn()
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            linkWechatWebIdentity: jest.fn().mockResolvedValue(undefined),
            linkWechatMobileIdentity: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuthNotificationService,
          useValue: {
            notifyOAuthLogin: jest.fn().mockResolvedValue(undefined),
            notifyIdentityLinked: jest.fn().mockResolvedValue(undefined),
            providerLabel: jest.fn((provider: string) => provider),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    authTokenService = module.get(AuthTokenService);
    authAccountService = module.get(AuthAccountService);
    authOAuthFacadeService = module.get(AuthOAuthFacadeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════
  // 1. Register
  // ══════════════════════════════════════════════════════════════
  // 3. Token Refresh
  // ══════════════════════════════════════════════════════════════

  describe('refresh', () => {
    it('should rotate refresh token and return a new pair', async () => {
      (authTokenService.refresh as jest.Mock).mockResolvedValueOnce(
        mockTokenPair,
      );

      const result = await service.refresh('valid-token', mockRequestContext);

      expect(authTokenService.refresh).toHaveBeenCalledWith(
        'valid-token',
        mockRequestContext,
      );
      expect(result.accessToken).toBe('mock-jwt-token');
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      await expect(service.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for expired refresh token', async () => {
      await expect(service.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 4. Logout
  // ══════════════════════════════════════════════════════════════

  describe('logout', () => {
    it('should delegate to authTokenService.revoke', async () => {
      await service.logout('user-uuid-1', 'some-refresh-token');

      expect(authTokenService.revoke).toHaveBeenCalledWith(
        'user-uuid-1',
        'some-refresh-token',
      );
    });
  });

  describe('logoutAll', () => {
    it('should delegate to authTokenService.revokeAll', async () => {
      await service.logoutAll('user-uuid-1');

      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-uuid-1');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 5. Profile Management
  // ══════════════════════════════════════════════════════════════

  describe('getActiveUser', () => {
    it('should delegate to authAccountService.getActiveUser', async () => {
      authAccountService.getActiveUser.mockResolvedValue(mockUser);

      const result = await service.getActiveUser('user-uuid-1');

      expect(authAccountService.getActiveUser).toHaveBeenCalledWith(
        'user-uuid-1',
      );
      expect(result).toEqual(mockUser);
    });

    it('should propagate errors from authAccountService.getActiveUser', async () => {
      authAccountService.getActiveUser.mockRejectedValue(
        new NotFoundException('user_not_found'),
      );

      await expect(service.getActiveUser('user-uuid-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteAccount', () => {
    it('should delegate to authAccountService.deleteAccount', async () => {
      await service.deleteAccount('user-uuid-1', {
        password: 'Password123!',
      });

      expect(authAccountService.deleteAccount).toHaveBeenCalledWith(
        'user-uuid-1',
        { password: 'Password123!' },
      );
    });

    it('should propagate errors from authAccountService.deleteAccount', async () => {
      authAccountService.deleteAccount.mockRejectedValue(
        new UnauthorizedException('invalid_credentials'),
      );

      await expect(
        service.deleteAccount('user-uuid-1', { password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 6. Email Verification & Password Reset
  // ══════════════════════════════════════════════════════════════

  describe('OAuth facade delegation', () => {
    const mockDto = { code: 'mock-auth-code', state: 'mock-oauth-state' };

    it('should delegate createWechatWebAuthorizeUrl to authOAuthFacadeService', async () => {
      const result = await service.createWechatWebAuthorizeUrl();

      expect(
        authOAuthFacadeService.createWechatWebAuthorizeUrl,
      ).toHaveBeenCalled();
      expect(result).toEqual({
        url: 'https://example.com/auth',
        state: 'mock-state',
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
      const result = await service.resolveWechatWebCallbackRedirect(mockDto);

      expect(
        authOAuthFacadeService.resolveWechatWebCallbackRedirect,
      ).toHaveBeenCalledWith(mockDto);
      expect(result).toBe('http://localhost:8080/callback');
    });

    it('should delegate loginWithWechatWeb to authOAuthFacadeService', async () => {
      const result = await service.loginWithWechatWeb(
        mockDto,
        mockRequestContext,
      );

      expect(authOAuthFacadeService.loginWithWechatWeb).toHaveBeenCalledWith(
        mockDto,
        mockRequestContext,
      );
      expect(result.accessToken).toBe('mock-jwt-token');
    });

    it('should propagate errors from authOAuthFacadeService.loginWithWechatWeb', async () => {
      (
        authOAuthFacadeService.loginWithWechatWeb as jest.Mock
      ).mockRejectedValueOnce(new Error('OAUTH_STATE_MISSING'));

      await expect(
        service.loginWithWechatWeb({ code: 'x', state: 'bad' }),
      ).rejects.toThrow();
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
      const result = await service.createWechatWebIdentityLinkAuthorizeUrl();

      expect(
        authOAuthFacadeService.createWechatWebIdentityLinkAuthorizeUrl,
      ).toHaveBeenCalled();
      expect(result).toEqual({
        url: 'https://example.com/link',
        state: 'mock-state',
      });
    });

    it('should delegate loginWithWechatMobile to authOAuthFacadeService', async () => {
      const dto = { code: 'mock-mobile-code' };
      const result = await service.loginWithWechatMobile(
        dto,
        mockRequestContext,
      );

      expect(authOAuthFacadeService.loginWithWechatMobile).toHaveBeenCalledWith(
        dto,
        mockRequestContext,
      );
      expect(result.accessToken).toBe('mock-jwt-token');
    });

    it('should delegate loginWithApple to authOAuthFacadeService', async () => {
      const dto = { identityToken: 'mock-apple-token' };
      const result = await service.loginWithApple(dto, mockRequestContext);

      expect(authOAuthFacadeService.loginWithApple).toHaveBeenCalledWith(
        dto,
        mockRequestContext,
      );
      expect(result.accessToken).toBe('mock-jwt-token');
    });

    it('should delegate createQqAuthorizeUrl to authOAuthFacadeService', async () => {
      const result = await service.createQqAuthorizeUrl();

      expect(authOAuthFacadeService.createQqAuthorizeUrl).toHaveBeenCalled();
      expect(result).toEqual({
        url: 'https://example.com/qq/auth',
        state: 'mock-state',
      });
    });

    it('should delegate loginWithQq to authOAuthFacadeService', async () => {
      const dto = { code: 'mock-qq-code', state: 'mock-qq-state' };
      const result = await service.loginWithQq(dto, mockRequestContext);

      expect(authOAuthFacadeService.loginWithQq).toHaveBeenCalledWith(
        dto,
        mockRequestContext,
      );
      expect(result.accessToken).toBe('mock-jwt-token');
    });
  });
});
