import { nonDeleted } from '../../common/utils/prisma.helpers';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { I18nService } from 'nestjs-i18n';
import * as argon2 from 'argon2';

import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { VerificationCodeService } from './services/verification-code.service';
import { AuthRateLimitService } from './services/auth-rate-limit.service';
import { AuthTokenService } from './services/auth-token.service';
import { AuthOAuthStateService } from './services/auth-oauth-state.service';
import { AuthOAuthService } from './services/auth-oauth.service';
import { UserStatus } from '../../generated/prisma/client';
import { WechatMobileOAuthProvider } from './providers/wechat-mobile-oauth.provider';
import { WechatWebOAuthProvider } from './providers/wechat-web-oauth.provider';
import { NotificationsService } from '../notifications/notifications.service';
import {
  OAUTH_PROVIDER_WECHAT_MOBILE,
  OAUTH_PROVIDER_WECHAT_WEB,
} from './types/oauth.types';

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
  let prismaService: jest.Mocked<PrismaService>;
  let userService: jest.Mocked<UserService>;
  let verificationCodeService: jest.Mocked<VerificationCodeService>;
  let authRateLimitService: jest.Mocked<AuthRateLimitService>;
  let authTokenService: jest.Mocked<AuthTokenService>;
  let authOAuthStateService: jest.Mocked<AuthOAuthStateService>;
  let authOAuthService: jest.Mocked<AuthOAuthService>;
  let wechatWebOAuthProvider: jest.Mocked<WechatWebOAuthProvider>;
  let wechatMobileOAuthProvider: jest.Mocked<WechatMobileOAuthProvider>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: { update: jest.fn() },
          },
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
            normalizeEmail: jest.fn(),
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
      ],
    }).compile();

    service = module.get(AuthService);
    prismaService = module.get(PrismaService);
    userService = module.get(UserService);
    verificationCodeService = module.get(VerificationCodeService);
    authRateLimitService = module.get(AuthRateLimitService);
    authTokenService = module.get(AuthTokenService);
    authOAuthStateService = module.get(AuthOAuthStateService);
    authOAuthService = module.get(AuthOAuthService);
    wechatWebOAuthProvider = module.get(WechatWebOAuthProvider);
    wechatMobileOAuthProvider = module.get(WechatMobileOAuthProvider);

    // argon2 defaults
    (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$newhash');
    (argon2.verify as jest.Mock).mockResolvedValue(true);

    // WeChat provider defaults
    wechatWebOAuthProvider.buildAuthorizeUrl.mockReturnValue(
      'https://open.weixin.qq.com/connect/qrconnect?mock=1',
    );
    wechatWebOAuthProvider.fetchProfile.mockResolvedValue({
      provider: OAUTH_PROVIDER_WECHAT_WEB,
      providerUserId: 'wechat-openid-1',
      unionId: 'wechat-unionid-1',
      email: null,
      nickname: 'WechatUser',
      avatar: 'https://example.com/wechat-avatar.png',
      rawProfile: { openid: 'wechat-openid-1' },
    });
    wechatMobileOAuthProvider.fetchProfile.mockResolvedValue({
      provider: OAUTH_PROVIDER_WECHAT_MOBILE,
      providerUserId: 'wechat-mobile-openid-1',
      unionId: 'wechat-unionid-1',
      email: null,
      nickname: 'WechatMobileUser',
      avatar: 'https://example.com/wechat-mobile-avatar.png',
      rawProfile: { openid: 'wechat-mobile-openid-1' },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════
  // 1. Register
  // ══════════════════════════════════════════════════════════════

  describe('register', () => {
    it('should register a new user and return user + tokens', async () => {
      const verifiedUser = {
        ...mockUser,
        emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
      };
      userService.findByEmail.mockResolvedValue(null);
      userService.create.mockResolvedValue(verifiedUser);

      const result = await service.register(
        {
          email: 'TEST@example.com',
          password: 'Password123!',
          code: '123456',
          nickname: 'TestUser',
        },
        mockRequestContext,
      );

      expect(userService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'register',
      );
      expect(argon2.hash).toHaveBeenCalledWith(
        'Password123!',
        expect.objectContaining({ type: argon2.argon2id }),
      );
      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          passwordHash: '$argon2id$newhash',
          nickname: 'TestUser',
          emailVerifiedAt: expect.any(Date) as Date,
          profile: { create: {} },
        }),
      );
      expect(authTokenService.generateTokenPair).toHaveBeenCalledWith(
        verifiedUser,
        mockRequestContext,
      );
      expect(result.user).toEqual(verifiedUser);
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.refreshToken).toBeDefined();
    });

    it('should throw ConflictException if email already exists', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'Password123!',
          code: '123456',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 2. Login
  // ══════════════════════════════════════════════════════════════

  describe('login', () => {
    it('should login with valid password and return user + tokens', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      userService.update.mockResolvedValue({
        ...mockUser,
        lastLoginAt: new Date(),
        status: UserStatus.active,
      });

      const result = await service.login(
        { email: 'test@example.com', password: 'Password123!' },
        mockRequestContext,
      );

      expect(authRateLimitService.checkLoginRateLimit).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(userService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$mock',
        'Password123!',
      );
      expect(authRateLimitService.clearLoginFailures).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(authTokenService.generateTokenPair).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-uuid-1' }),
        mockRequestContext,
      );
      expect(result.accessToken).toBe('mock-jwt-token');
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'noone@example.com', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(authRateLimitService.recordLoginFailure).toHaveBeenCalledWith(
        'noone@example.com',
      );
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(authRateLimitService.checkLoginRateLimit).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(authRateLimitService.recordLoginFailure).toHaveBeenCalledWith(
        'test@example.com',
      );
    });

    it('should reject password login when the user has no local password', async () => {
      const oauthUser = { ...mockUser, passwordHash: null };
      userService.findByEmail.mockResolvedValue(oauthUser);

      await expect(
        service.login({ email: 'test@example.com', password: 'try' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(authRateLimitService.recordLoginFailure).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it('should reject login while email is rate limited', async () => {
      (
        authRateLimitService.checkLoginRateLimit as jest.Mock
      ).mockRejectedValueOnce(
        new UnauthorizedException({
          code: 'RATE_LIMITED',
          message: 'Too many attempts',
        }),
      );

      await expect(
        service.login({ email: 'test@example.com', password: 'Password123!' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(userService.findByEmail).not.toHaveBeenCalled();
    });

    it('should throw when no credential is provided', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.login({ email: 'test@example.com' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw when both password and code are provided', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'Password123!',
          code: '123456',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should login with verification code', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      userService.update.mockResolvedValue({
        ...mockUser,
        lastLoginAt: new Date(),
        status: UserStatus.active,
      });

      const result = await service.login({
        email: 'test@example.com',
        code: '123456',
      });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'login',
      );
      expect(argon2.verify).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('mock-jwt-token');
    });
  });

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
    it('should return user by id', async () => {
      userService.findById.mockResolvedValue(mockUser);

      const result = await service.getActiveUser('user-uuid-1');
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException if user not found', async () => {
      userService.findById.mockResolvedValue(null);

      await expect(service.getActiveUser('user-uuid-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('changePassword', () => {
    it('should change password and logout all devices', async () => {
      userService.findById.mockResolvedValue(mockUser);

      await service.changePassword('user-uuid-1', {
        oldPassword: 'OldPassword123!',
        newPassword: 'NewPassword123!',
      });

      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$mock',
        'OldPassword123!',
      );
      expect(argon2.hash).toHaveBeenCalledWith(
        'NewPassword123!',
        expect.objectContaining({ type: argon2.argon2id }),
      );
      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        passwordHash: '$argon2id$newhash',
      });
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-uuid-1');
    });

    it('should throw UnauthorizedException for wrong old password', async () => {
      userService.findById.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.changePassword('user-uuid-1', {
          oldPassword: 'wrong',
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject password change when the user has no local password', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        passwordHash: null,
      });

      await expect(
        service.changePassword('user-uuid-1', {
          oldPassword: 'any',
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('setPassword', () => {
    it('should set password for OAuth-only user with existing email', async () => {
      const oauthUser = {
        ...mockUser,
        email: 'test@example.com',
        passwordHash: null,
      };
      userService.findById.mockResolvedValue(oauthUser);
      (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$set');

      await service.setPassword('user-uuid-1', {
        code: '123456',
        password: 'NewPassw0rd',
      });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'set-password',
      );
      expect(argon2.hash).toHaveBeenCalled();
      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        passwordHash: '$argon2id$set',
      });
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-uuid-1');
    });

    it('should bind email and set password for OAuth-only user without email', async () => {
      const oauthUser = { ...mockUser, email: null, passwordHash: null };
      userService.findById.mockResolvedValue(oauthUser);
      userService.findByEmail.mockResolvedValue(null);
      (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$set');

      await service.setPassword('user-uuid-1', {
        email: 'new@example.com',
        code: '123456',
        password: 'NewPassw0rd',
      });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'new@example.com',
        '123456',
        'set-password',
      );
      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        email: 'new@example.com',
        emailVerifiedAt: expect.any(Date) as Date,
      });
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-uuid-1');
    });

    it('should throw if user already has a password', async () => {
      userService.findById.mockResolvedValue(mockUser);

      await expect(
        service.setPassword('user-uuid-1', {
          code: '123456',
          password: 'NewPassw0rd',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw if user has no email and none is provided', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        email: null,
        passwordHash: null,
      });

      await expect(
        service.setPassword('user-uuid-1', {
          code: '123456',
          password: 'NewPassw0rd',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if the provided email is already in use', async () => {
      const oauthUser = { ...mockUser, email: null, passwordHash: null };
      userService.findById.mockResolvedValue(oauthUser);
      userService.findByEmail.mockResolvedValue({
        ...mockUser,
        id: 'other-user',
      });

      await expect(
        service.setPassword('user-uuid-1', {
          email: 'test@example.com',
          code: '123456',
          password: 'NewPassw0rd',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should revoke all sessions after setting password', async () => {
      const oauthUser = {
        ...mockUser,
        email: 'test@example.com',
        passwordHash: null,
      };
      userService.findById.mockResolvedValue(oauthUser);
      (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$set');

      await service.setPassword('user-uuid-1', {
        code: '123456',
        password: 'NewPassw0rd',
      });

      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-uuid-1');
    });
  });

  describe('changeEmail', () => {
    it('should change email after verification', async () => {
      userService.findById.mockResolvedValue(mockUser);
      userService.findByEmail.mockResolvedValue(null);
      userService.update.mockResolvedValue({
        ...mockUser,
        email: 'new@example.com',
        emailVerifiedAt: new Date(),
      });

      const result = await service.changeEmail('user-uuid-1', {
        newEmail: '  New@Example.COM  ',
        code: '123456',
      });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'new@example.com',
        '123456',
        'change-email',
      );
      expect(result.email).toBe('new@example.com');
    });

    it('should throw ConflictException if new email already taken', async () => {
      userService.findById.mockResolvedValue(mockUser);
      userService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.changeEmail('user-uuid-1', {
          newEmail: 'test@example.com',
          code: '123456',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteAccount', () => {
    it('should soft-delete user after password verification', async () => {
      userService.findById.mockResolvedValue(mockUser);

      await service.deleteAccount('user-uuid-1', {
        password: 'Password123!',
      });

      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$mock',
        'Password123!',
      );
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-uuid-1');
      expect(prismaService.user.update).toHaveBeenCalledTimes(1);
      const updateCall = (prismaService.user.update as jest.Mock).mock
        .calls[0] as [Parameters<typeof prismaService.user.update>[0]];
      expect(updateCall[0].where).toEqual({ id: 'user-uuid-1' });
      expect(updateCall[0].data).toMatchObject({
        status: UserStatus.deleted,
      });
      expect(updateCall[0].data.deletedAt).toBeInstanceOf(Date);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      userService.findById.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.deleteAccount('user-uuid-1', { password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject password-based deletion for OAuth-only users', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        passwordHash: null,
      });

      await expect(
        service.deleteAccount('user-uuid-1', { password: 'any' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should soft-delete OAuth-only user via email code verification', async () => {
      const oauthUser = {
        ...mockUser,
        email: 'test@example.com',
        passwordHash: null,
      };
      userService.findById.mockResolvedValue(oauthUser);

      await service.deleteAccount('user-uuid-1', { code: '123456' });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'delete-account',
      );
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-uuid-1');
      expect(prismaService.user.update).toHaveBeenCalledTimes(1);
    });

    it('should throw when OAuth-only user has no email for code deletion', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        email: null,
        passwordHash: null,
      });

      await expect(
        service.deleteAccount('user-uuid-1', { code: '123456' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when neither password nor code is provided', async () => {
      userService.findById.mockResolvedValue(mockUser);

      await expect(service.deleteAccount('user-uuid-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 6. Email Verification & Password Reset
  // ══════════════════════════════════════════════════════════════

  describe('sendVerificationCode', () => {
    it('should delegate to verificationCodeService.send', async () => {
      const result = await service.sendVerificationCode({
        email: '  Test@Example.COM  ',
        scene: 'register',
      });

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'register',
        undefined,
      );
      expect(result.message).toBe('auth.verification_code_sent');
    });
  });

  describe('verifyEmail', () => {
    it('should verify code and mark email as verified', async () => {
      await service.verifyEmail({
        email: '  Test@Example.COM  ',
        code: '123456',
      });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'register',
      );
      expect(userService.updateByEmail).toHaveBeenCalledWith(
        'test@example.com',
        { emailVerifiedAt: expect.any(Date) as Date },
      );
    });
  });

  describe('forgotPassword', () => {
    it('should send reset code if user exists', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      const result = await service.forgotPassword({
        email: 'test@example.com',
      });

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'reset-password',
      );
      expect(result.message).toBeDefined();
    });

    it('should return success message even if user does not exist', async () => {
      userService.findByEmail.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'noone@example.com',
      });

      expect(verificationCodeService.send).not.toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });
  });

  describe('resetPassword', () => {
    it('should verify code, hash new password, and logout all devices', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      (prismaService.user.update as jest.Mock).mockResolvedValue(undefined);

      await service.resetPassword({
        email: '  Test@Example.COM  ',
        code: '123456',
        password: 'NewPassword123!',
      });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'reset-password',
      );
      expect(argon2.hash).toHaveBeenCalledWith(
        'NewPassword123!',
        expect.objectContaining({ type: argon2.argon2id }),
      );
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { passwordHash: '$argon2id$newhash' },
      });
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-uuid-1');
    });

    it('should throw NotFoundException if user not found after code verification', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          email: 'noone@example.com',
          code: '123456',
          password: 'NewPassword123!',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 7. WeChat Web OAuth
  // ══════════════════════════════════════════════════════════════

  describe('wechat web oauth', () => {
    const mockDto = { code: 'mock-auth-code', state: 'mock-oauth-state' };

    beforeEach(() => {
      // sub-service defaults for OAuth
      (authOAuthStateService.createState as jest.Mock).mockResolvedValue({
        state: 'mock-oauth-state',
        ttlSec: 600,
        callbackUri: undefined,
      });
      (authOAuthStateService.peek as jest.Mock).mockResolvedValue({
        callbackUri: 'http://localhost:8080/callback',
        targetUrl: '/',
        purpose: 'login',
        platform: 'web',
      });
      (authOAuthStateService.consume as jest.Mock).mockResolvedValue({
        callbackUri: 'http://localhost:8080/callback',
        targetUrl: '/',
        purpose: 'login',
      });
      (authOAuthStateService.buildRedirectUrl as jest.Mock).mockReturnValue(
        'http://localhost:8080/callback?code=mock-auth-code&state=mock-oauth-state',
      );

      (authOAuthService.findOrCreateOAuthUser as jest.Mock).mockResolvedValue(
        mockUser,
      );
      (authOAuthService.updateOAuthLoginUser as jest.Mock).mockResolvedValue(
        mockUser,
      );
    });

    it('should create a WeChat web authorize URL', async () => {
      const result = await service.createWechatWebAuthorizeUrl();

      expect(authOAuthStateService.createState).toHaveBeenCalledWith(
        'login',
        undefined,
      );
      expect(wechatWebOAuthProvider.buildAuthorizeUrl).toHaveBeenCalledWith(
        'mock-oauth-state',
      );
      expect(result.authorizeUrl).toBe(
        'https://open.weixin.qq.com/connect/qrconnect?mock=1',
      );
      expect(result.state).toBe('mock-oauth-state');
    });

    it('should pass callbackUri when provided', async () => {
      await service.createWechatWebAuthorizeUrl({
        callbackUri: 'http://localhost:8080/callback',
      });

      expect(authOAuthStateService.createState).toHaveBeenCalledWith(
        'login',
        'http://localhost:8080/callback',
      );
    });

    it('should resolve WeChat web callback redirect', async () => {
      const result = await service.resolveWechatWebCallbackRedirect(mockDto);

      expect(authOAuthStateService.peek).toHaveBeenCalledWith(
        'mock-oauth-state',
      );
      expect(result).toContain('mock-auth-code');
    });

    it('should create a passwordless user from WeChat profile and return tokens', async () => {
      (authOAuthStateService.consume as jest.Mock).mockResolvedValue({
        callbackUri: 'http://localhost:8080/callback',
        targetUrl: '/',
        purpose: 'login',
      });

      const result = await service.loginWithWechatWeb(
        mockDto,
        mockRequestContext,
      );

      expect(authOAuthStateService.consume).toHaveBeenCalledWith(
        'mock-oauth-state',
        'login',
      );
      expect(wechatWebOAuthProvider.fetchProfile).toHaveBeenCalledWith(
        'mock-auth-code',
      );
      expect(authOAuthService.findOrCreateOAuthUser).toHaveBeenCalled();
      expect(authTokenService.generateTokenPair).toHaveBeenCalled();
      expect(result.accessToken).toBe('mock-jwt-token');
    });

    it('should reject callback when OAuth state is missing', async () => {
      (authOAuthStateService.consume as jest.Mock).mockRejectedValueOnce(
        new Error('OAUTH_STATE_MISSING'),
      );

      await expect(
        service.loginWithWechatWeb({ code: 'x', state: 'bad' }),
      ).rejects.toThrow();
    });

    it('should link WeChat web identity to the current user', async () => {
      userService.findById.mockResolvedValue(mockUser);

      await service.linkWechatWebIdentity('user-uuid-1', mockDto);

      expect(authOAuthStateService.consume).toHaveBeenCalledWith(
        'mock-oauth-state',
        'link',
      );
      expect(authOAuthService.linkOAuthProfileToUser).toHaveBeenCalledWith(
        'user-uuid-1',
        expect.objectContaining({
          provider: OAUTH_PROVIDER_WECHAT_WEB,
        }),
      );
    });

    it('should link WeChat mobile identity to the current user', async () => {
      userService.findById.mockResolvedValue(mockUser);
      (authOAuthService.linkOAuthProfileToUser as jest.Mock).mockResolvedValue(
        undefined,
      );

      await service.linkWechatMobileIdentity('user-uuid-1', {
        code: 'mock-mobile-code',
      });

      expect(wechatMobileOAuthProvider.fetchProfile).toHaveBeenCalledWith(
        'mock-mobile-code',
      );
      expect(authOAuthService.linkOAuthProfileToUser).toHaveBeenCalledWith(
        'user-uuid-1',
        expect.objectContaining({
          provider: OAUTH_PROVIDER_WECHAT_MOBILE,
        }),
      );
    });
  });
});
