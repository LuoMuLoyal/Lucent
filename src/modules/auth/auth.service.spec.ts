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

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(),
  verify: vi.fn(),
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
  let authTokenService: vi.Mocked<AuthTokenService>;
  let authAccountService: vi.Mocked<AuthAccountService>;
  let authOAuthFacadeService: vi.Mocked<AuthOAuthFacadeService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PinoLogger,
          useValue: {
            setContext: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
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
            generateTokenPair: vi.fn().mockResolvedValue(mockTokenPair),
            refresh: vi
              .fn()
              .mockRejectedValue(new Error('REFRESH_TOKEN_INVALID')),
            revoke: vi.fn(),
            revokeAll: vi.fn(),
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
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            login: vi
              .fn()
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            changePassword: vi.fn().mockResolvedValue(undefined),
            setPassword: vi.fn().mockResolvedValue(undefined),
            changeEmail: vi.fn().mockResolvedValue(mockUser),
            sendVerificationCode: vi
              .fn()
              .mockResolvedValue({ message: 'verification_code_sent' }),
            verifyEmail: vi.fn().mockResolvedValue(undefined),
            forgotPassword: vi
              .fn()
              .mockResolvedValue({ message: 'forgot_password_hint' }),
            resetPassword: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuthAccountService,
          useValue: {
            getActiveUser: vi.fn().mockResolvedValue(mockUser),
            deleteAccount: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuthOAuthFacadeService,
          useValue: {
            createWechatWebAuthorizeUrl: vi.fn().mockResolvedValue({
              url: 'https://example.com/auth',
              state: 'mock-state',
            }),
            createWechatWebIdentityLinkAuthorizeUrl: vi.fn().mockResolvedValue({
              url: 'https://example.com/link',
              state: 'mock-state',
            }),
            resolveWechatWebCallbackRedirect: vi
              .fn()
              .mockResolvedValue('http://localhost:8080/callback'),
            loginWithWechatWeb: vi
              .fn()
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            loginWithWechatMobile: vi
              .fn()
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            loginWithApple: vi
              .fn()
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            createQqAuthorizeUrl: vi.fn().mockResolvedValue({
              url: 'https://example.com/qq/auth',
              state: 'mock-state',
            }),
            loginWithQq: vi
              .fn()
              .mockResolvedValue({ user: mockUser, ...mockTokenPair }),
            linkWechatWebIdentity: vi.fn().mockResolvedValue(undefined),
            linkWechatMobileIdentity: vi.fn().mockResolvedValue(undefined),
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

    service = module.get(AuthService);
    authTokenService = module.get(AuthTokenService);
    authAccountService = module.get(AuthAccountService);
    authOAuthFacadeService = module.get(AuthOAuthFacadeService);
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
      (authTokenService.refresh as vi.Mock).mockResolvedValueOnce(
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
        authOAuthFacadeService.loginWithWechatWeb as vi.Mock
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
