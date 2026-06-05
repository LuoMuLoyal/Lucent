import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { I18nService } from 'nestjs-i18n';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';

import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { VerificationCodeService } from './verification-code.service';
import { UserStatus } from '../../generated/prisma/client';
import { WechatMobileOAuthProvider } from './wechat-mobile-oauth.provider';
import { WechatWebOAuthProvider } from './wechat-web-oauth.provider';
import {
  OAUTH_PROVIDER_WECHAT_MOBILE,
  OAUTH_PROVIDER_WECHAT_WEB,
} from './oauth.types';

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
  deletedAt: null,
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

const mockOAuthOnlyUser = {
  ...mockUser,
  passwordHash: null,
};

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function loginFailureKey(email: string): string {
  const digest = createHash('sha256').update(email).digest('hex');
  return `auth:login-failure:${digest}`;
}

interface LoginFailureBucketTestShape {
  count: number;
  resetAt: number;
  lockedUntil?: number;
}

function getLastCacheSetCall(cache: {
  set: jest.Mock;
}): [string, LoginFailureBucketTestShape, number] {
  const calls = cache.set.mock.calls as unknown[][];
  const call = calls.at(-1);
  expect(call).toBeDefined();
  return call as [string, LoginFailureBucketTestShape, number];
}

function getLastSessionCreateData(prismaService: jest.Mocked<PrismaService>): {
  ipAddress?: string;
  userAgent?: string;
} {
  const calls = (prismaService.userSession.create as jest.Mock).mock
    .calls as unknown[][];
  const call = calls.at(-1);
  expect(call).toBeDefined();
  const [args] = call as [{ data: { ipAddress?: string; userAgent?: string } }];
  return args.data;
}

describe('AuthService', () => {
  let service: AuthService;
  let cache: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let prismaService: jest.Mocked<PrismaService>;
  let userService: jest.Mocked<UserService>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: {
    get: jest.Mock;
    getOrThrow: jest.Mock;
  };
  let verificationCodeService: jest.Mocked<VerificationCodeService>;
  let wechatMobileOAuthProvider: jest.Mocked<WechatMobileOAuthProvider>;
  let wechatWebOAuthProvider: jest.Mocked<WechatWebOAuthProvider>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            userSession: {
              create: jest.fn(),
              findUnique: jest.fn(),
              delete: jest.fn(),
              deleteMany: jest.fn(),
            },
            user: {
              update: jest.fn(),
            },
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
          useValue: {
            signAsync: jest.fn(),
          },
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
          useValue: {
            t: jest.fn((key: string) => key),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    cache = module.get(CACHE_MANAGER);
    prismaService = module.get(PrismaService);
    userService = module.get(UserService);
    jwtService = module.get(JwtService);
    configService = module.get(ConfigService);
    verificationCodeService = module.get(VerificationCodeService);
    wechatMobileOAuthProvider = module.get(WechatMobileOAuthProvider);
    wechatWebOAuthProvider = module.get(WechatWebOAuthProvider);

    (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$newhash');
    (argon2.verify as jest.Mock).mockResolvedValue(true);
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    cache.del.mockResolvedValue(undefined);
    jwtService.signAsync.mockResolvedValue('mock-jwt-token');
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
    (prismaService.userSession.create as jest.Mock).mockResolvedValue({
      id: 'session-id',
      userId: mockUser.id,
      refreshTokenHash: hashRefreshToken('created-token'),
      deviceType: null,
      deviceName: null,
      platform: null,
      appVersion: null,
      ipAddress: null,
      userAgent: null,
      context: null,
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + 14 * 86_400 * 1000),
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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
      expect(result.user).toEqual(verifiedUser);
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.refreshToken).toBeDefined();
      expect(getLastSessionCreateData(prismaService)).toEqual(
        expect.objectContaining(mockRequestContext),
      );
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
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should login with valid password and return user + tokens', async () => {
      const updatedUser = {
        ...mockUser,
        lastLoginAt: new Date('2026-01-02T00:00:00Z'),
      };
      userService.findByEmail.mockResolvedValue(mockUser);
      userService.update.mockResolvedValue(updatedUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.login(
        {
          email: 'test@example.com',
          password: 'Password123!',
        },
        mockRequestContext,
      );

      expect(argon2.verify).toHaveBeenCalledWith(
        mockUser.passwordHash,
        'Password123!',
      );
      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        lastLoginAt: expect.any(Date) as Date,
        status: UserStatus.active,
      });
      expect(result.user).toEqual(updatedUser);
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(getLastSessionCreateData(prismaService)).toEqual(
        expect.objectContaining(mockRequestContext),
      );
      expect(cache.del).toHaveBeenCalledWith(
        loginFailureKey('test@example.com'),
      );
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'noone@example.com', password: 'Password123!' }),
      ).rejects.toThrow(UnauthorizedException);
      const [key, bucket, ttl] = getLastCacheSetCall(cache);
      expect(key).toBe(loginFailureKey('noone@example.com'));
      expect(bucket.count).toBe(1);
      expect(typeof bucket.resetAt).toBe('number');
      expect(typeof ttl).toBe('number');
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
      const [key, bucket, ttl] = getLastCacheSetCall(cache);
      expect(key).toBe(loginFailureKey('test@example.com'));
      expect(bucket.count).toBe(1);
      expect(typeof bucket.resetAt).toBe('number');
      expect(typeof ttl).toBe('number');
    });

    it('should reject password login when the user has no local password', async () => {
      userService.findByEmail.mockResolvedValue(mockOAuthOnlyUser);
      (argon2.verify as jest.Mock).mockClear();

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'Password123!',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(argon2.verify).not.toHaveBeenCalled();
      const [key, bucket, ttl] = getLastCacheSetCall(cache);
      expect(key).toBe(loginFailureKey('test@example.com'));
      expect(bucket.count).toBe(1);
      expect(typeof bucket.resetAt).toBe('number');
      expect(typeof ttl).toBe('number');
    });

    it('should reject login while email is rate limited', async () => {
      cache.get.mockResolvedValue({
        count: 10,
        resetAt: Date.now() + 15 * 60 * 1000,
        lockedUntil: Date.now() + 60 * 60 * 1000,
      });

      await expect(
        service.login({ email: 'test@example.com', password: 'Password123!' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(userService.findByEmail).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('should increment login failures and lock after the maximum', async () => {
      cache.get.mockResolvedValueOnce(null).mockResolvedValueOnce({
        count: 9,
        resetAt: Date.now() + 15 * 60 * 1000,
      });
      userService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);

      const [key, bucket, ttl] = getLastCacheSetCall(cache);
      expect(key).toBe(loginFailureKey('test@example.com'));
      expect(bucket.count).toBe(10);
      expect(typeof bucket.lockedUntil).toBe('number');
      expect(typeof ttl).toBe('number');
    });

    it('should throw UnauthorizedException when no credential is provided', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockClear();
      verificationCodeService.verify.mockClear();

      await expect(
        service.login({ email: 'test@example.com' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(argon2.verify).not.toHaveBeenCalled();
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when both password and code are provided', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockClear();
      verificationCodeService.verify.mockClear();

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'Password123!',
          code: '123456',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(argon2.verify).not.toHaveBeenCalled();
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });

    it('should login with verification code', async () => {
      const updatedUser = {
        ...mockUser,
        lastLoginAt: new Date('2026-01-02T00:00:00Z'),
      };
      userService.findByEmail.mockResolvedValue(mockUser);
      userService.update.mockResolvedValue(updatedUser);
      verificationCodeService.verify.mockResolvedValue(true);

      const result = await service.login({
        email: 'test@example.com',
        code: '123456',
      });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'login',
      );
      expect(result.user).toEqual(updatedUser);
    });
  });

  describe('refresh', () => {
    it('should rotate refresh token and return new token pair', async () => {
      const refreshToken = 'old-refresh-token';
      const mockRefreshRecord = {
        id: 'session-id',
        userId: 'user-uuid-1',
        refreshTokenHash: hashRefreshToken(refreshToken),
        deviceType: null,
        deviceName: null,
        platform: null,
        appVersion: null,
        ipAddress: null,
        userAgent: null,
        context: null,
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400 * 1000),
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: mockUser,
      };

      (prismaService.userSession.findUnique as jest.Mock).mockResolvedValue(
        mockRefreshRecord,
      );
      (prismaService.userSession.delete as jest.Mock).mockResolvedValue(
        mockRefreshRecord,
      );

      const result = await service.refresh(refreshToken, mockRequestContext);

      expect(prismaService.userSession.findUnique).toHaveBeenCalledWith({
        where: { refreshTokenHash: hashRefreshToken(refreshToken) },
        include: { user: true },
      });
      expect(prismaService.userSession.delete).toHaveBeenCalledWith({
        where: { id: 'session-id' },
      });
      expect(getLastSessionCreateData(prismaService)).toEqual(
        expect.objectContaining(mockRequestContext),
      );
      expect(prismaService.userSession.deleteMany).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('mock-jwt-token');
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      (prismaService.userSession.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.refresh('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for expired refresh token', async () => {
      (prismaService.userSession.findUnique as jest.Mock).mockResolvedValue({
        id: 'session-id',
        userId: 'user-uuid-1',
        refreshTokenHash: hashRefreshToken('expired-token'),
        deviceType: null,
        deviceName: null,
        platform: null,
        appVersion: null,
        ipAddress: null,
        userAgent: null,
        context: null,
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() - 86_400 * 1000),
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: mockUser,
      });

      await expect(service.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should delete only the current user refresh token session', async () => {
      (prismaService.userSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await service.logout('user-uuid-1', 'some-refresh-token');

      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-uuid-1',
          refreshTokenHash: hashRefreshToken('some-refresh-token'),
        },
      });
    });
  });

  describe('logoutAll', () => {
    it('should delete all refresh token sessions for a user', async () => {
      (prismaService.userSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 3,
      });

      await service.logoutAll('user-uuid-1');

      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
    });
  });

  describe('getMe', () => {
    it('should return user by id', async () => {
      userService.findById.mockResolvedValue(mockUser);

      const result = await service.getMe('user-uuid-1');

      expect(userService.findById).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException if user not found', async () => {
      userService.findById.mockResolvedValue(null);

      await expect(service.getMe('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateMe', () => {
    it('should update nickname and avatar', async () => {
      const updatedUser = {
        ...mockUser,
        nickname: 'NewName',
        avatar: 'https://example.com/avatar.png',
      };
      userService.update.mockResolvedValue(updatedUser);

      const result = await service.updateMe('user-uuid-1', {
        nickname: 'NewName',
        avatar: 'https://example.com/avatar.png',
      });

      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        nickname: 'NewName',
        avatar: 'https://example.com/avatar.png',
      });
      expect(result.nickname).toBe('NewName');
    });

    it('should clear nickname and avatar when empty strings are provided', async () => {
      userService.update.mockResolvedValue({
        ...mockUser,
        nickname: null,
        avatar: null,
      });

      await service.updateMe('user-uuid-1', {
        nickname: '',
        avatar: '',
      });

      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        nickname: null,
        avatar: null,
      });
    });
  });

  describe('changePassword', () => {
    it('should change password and logout all devices', async () => {
      userService.findById.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      userService.update.mockResolvedValue(mockUser);
      (prismaService.userSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await service.changePassword('user-uuid-1', {
        oldPassword: 'OldPass123!',
        newPassword: 'NewPass456!',
      });

      expect(argon2.verify).toHaveBeenCalledWith(
        mockUser.passwordHash,
        'OldPass123!',
      );
      expect(argon2.hash).toHaveBeenCalledWith(
        'NewPass456!',
        expect.objectContaining({ type: argon2.argon2id }),
      );
      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        passwordHash: '$argon2id$newhash',
      });
      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
    });

    it('should throw UnauthorizedException for wrong old password', async () => {
      userService.findById.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-uuid-1', {
          oldPassword: 'WrongOldPass!',
          newPassword: 'NewPass456!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject password change when the user has no local password', async () => {
      userService.findById.mockResolvedValue(mockOAuthOnlyUser);
      (argon2.verify as jest.Mock).mockClear();

      await expect(
        service.changePassword('user-uuid-1', {
          oldPassword: 'OldPass123!',
          newPassword: 'NewPass456!',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(argon2.verify).not.toHaveBeenCalled();
      expect(userService.update).not.toHaveBeenCalled();
      expect(prismaService.userSession.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('changeEmail', () => {
    it('should change email after verification', async () => {
      userService.findById.mockResolvedValue(mockUser);
      verificationCodeService.verify.mockResolvedValue(true);
      userService.findByEmail.mockResolvedValue(null);
      userService.update.mockResolvedValue({
        ...mockUser,
        email: 'new@example.com',
        emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
      });

      const result = await service.changeEmail('user-uuid-1', {
        newEmail: 'NEW@example.com',
        code: '654321',
      });

      expect(userService.findById).toHaveBeenCalledWith('user-uuid-1');
      expect(userService.findByEmail).toHaveBeenCalledWith('new@example.com');
      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'new@example.com',
        '654321',
        'change-email',
      );
      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        email: 'new@example.com',
        emailVerifiedAt: expect.any(Date) as Date,
      });
      expect(result.email).toBe('new@example.com');
    });

    it('should throw ConflictException if new email already taken', async () => {
      userService.findById.mockResolvedValue(mockUser);
      userService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.changeEmail('user-uuid-1', {
          newEmail: 'taken@example.com',
          code: '654321',
        }),
      ).rejects.toThrow(ConflictException);
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });
  });

  describe('deleteAccount', () => {
    it('should soft-delete user after password verification', async () => {
      userService.findById.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      (prismaService.userSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prismaService.user.update as jest.Mock).mockResolvedValue({
        ...mockUser,
        deletedAt: new Date('2026-01-02T00:00:00Z'),
        status: UserStatus.deleted,
      });

      await service.deleteAccount('user-uuid-1', { password: 'Password123!' });

      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: {
          deletedAt: expect.any(Date) as Date,
          status: UserStatus.deleted,
        },
      });
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      userService.findById.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.deleteAccount('user-uuid-1', { password: 'WrongPass!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject account deletion when the user has no local password', async () => {
      userService.findById.mockResolvedValue(mockOAuthOnlyUser);
      (argon2.verify as jest.Mock).mockClear();

      await expect(
        service.deleteAccount('user-uuid-1', { password: 'Password123!' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(argon2.verify).not.toHaveBeenCalled();
      expect(prismaService.userSession.deleteMany).not.toHaveBeenCalled();
      expect(prismaService.user.update).not.toHaveBeenCalled();
    });
  });

  describe('sendVerificationCode', () => {
    it('should delegate to verificationCodeService.send', async () => {
      verificationCodeService.send.mockResolvedValue(undefined);

      const result = await service.sendVerificationCode({
        email: 'TEST@example.com',
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
      verificationCodeService.verify.mockResolvedValue(true);
      userService.updateByEmail.mockResolvedValue({
        ...mockUser,
        emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
      });

      await service.verifyEmail({ email: 'TEST@example.com', code: '123456' });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'register',
      );
      expect(userService.updateByEmail).toHaveBeenCalledWith(
        'test@example.com',
        {
          emailVerifiedAt: expect.any(Date) as Date,
        },
      );
    });
  });

  describe('forgotPassword', () => {
    it('should send reset code if user exists', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      verificationCodeService.send.mockResolvedValue(undefined);

      const result = await service.forgotPassword({
        email: 'TEST@example.com',
      });

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'reset-password',
      );
      expect(
        verificationCodeService.assertClientRateLimit,
      ).toHaveBeenCalledWith(undefined);
      expect(result.message).toBe('auth.forgot_password_hint');
    });

    it('should return success message even if user does not exist', async () => {
      userService.findByEmail.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'noone@example.com',
      });

      expect(
        verificationCodeService.assertClientRateLimit,
      ).toHaveBeenCalledWith(undefined);
      expect(verificationCodeService.send).not.toHaveBeenCalled();
      expect(result.message).toBe('auth.forgot_password_hint');
    });
  });

  describe('resetPassword', () => {
    it('should verify code, hash new password, and logout all devices', async () => {
      verificationCodeService.verify.mockResolvedValue(true);
      userService.findByEmail.mockResolvedValue(mockUser);
      (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$reset');
      (prismaService.user.update as jest.Mock).mockResolvedValue(mockUser);
      (prismaService.userSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await service.resetPassword({
        email: 'TEST@example.com',
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
        data: { passwordHash: '$argon2id$reset' },
      });
      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
    });

    it('should throw NotFoundException if user not found after code verification', async () => {
      verificationCodeService.verify.mockResolvedValue(true);
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          email: 'ghost@example.com',
          code: '123456',
          password: 'NewPass!',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('wechat web oauth', () => {
    it('should create a WeChat web authorize URL and cache state', async () => {
      const result = await service.createWechatWebAuthorizeUrl();

      expect(result.authorizeUrl).toBe(
        'https://open.weixin.qq.com/connect/qrconnect?mock=1',
      );
      expect(result.state).toBeDefined();
      expect(result.expiresIn).toBe(600);
      expect(wechatWebOAuthProvider.buildAuthorizeUrl).toHaveBeenCalledWith(
        result.state,
      );
      expect(cache.set).toHaveBeenCalledWith(
        `auth:oauth-state:${OAUTH_PROVIDER_WECHAT_WEB}:${createHash('sha256')
          .update(result.state)
          .digest('hex')}`,
        {
          provider: OAUTH_PROVIDER_WECHAT_WEB,
        },
        600_000,
      );
    });

    it('should cache a loopback callback URI for desktop WeChat web OAuth', async () => {
      const result = await service.createWechatWebAuthorizeUrl({
        callbackUri: ' http://127.0.0.1:49152/oauth/wechat?stale=1 ',
      });

      expect(result.callbackUri).toBe('http://127.0.0.1:49152/oauth/wechat');
      expect(cache.set).toHaveBeenCalledWith(
        `auth:oauth-state:${OAUTH_PROVIDER_WECHAT_WEB}:${createHash('sha256')
          .update(result.state)
          .digest('hex')}`,
        {
          provider: OAUTH_PROVIDER_WECHAT_WEB,
          callbackUri: 'http://127.0.0.1:49152/oauth/wechat',
        },
        600_000,
      );
    });

    it('should reject non-loopback desktop callback URIs', async () => {
      await expect(
        service.createWechatWebAuthorizeUrl({
          callbackUri: 'https://evil.example.com/oauth/wechat',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(cache.set).not.toHaveBeenCalled();
      expect(wechatWebOAuthProvider.buildAuthorizeUrl).not.toHaveBeenCalled();
    });

    it('should cache a trusted web callback URI for web WeChat OAuth', async () => {
      configService.get.mockReturnValue(['https://app.example.com']);

      const result = await service.createWechatWebAuthorizeUrl({
        callbackUri: 'https://app.example.com/login/oauth/wechat?stale=1',
      });

      expect(result.callbackUri).toBe(
        'https://app.example.com/login/oauth/wechat',
      );
      expect(cache.set).toHaveBeenCalledWith(
        `auth:oauth-state:${OAUTH_PROVIDER_WECHAT_WEB}:${createHash('sha256')
          .update(result.state)
          .digest('hex')}`,
        {
          provider: OAUTH_PROVIDER_WECHAT_WEB,
          callbackUri: 'https://app.example.com/login/oauth/wechat',
        },
        600_000,
      );
    });

    it('should reject untrusted web callback origins', async () => {
      configService.get.mockReturnValue(['https://app.example.com']);

      await expect(
        service.createWechatWebAuthorizeUrl({
          callbackUri: 'https://evil.example.com/login/oauth/wechat',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should resolve desktop WeChat web callback redirect without consuming state', async () => {
      cache.get.mockResolvedValue({
        provider: OAUTH_PROVIDER_WECHAT_WEB,
        callbackUri: 'http://127.0.0.1:49152/oauth/wechat',
      });

      const redirectUrl = await service.resolveWechatWebCallbackRedirect({
        code: 'wechat-code',
        state: 'oauth-state',
      });

      expect(redirectUrl).toBe(
        'http://127.0.0.1:49152/oauth/wechat?code=wechat-code&state=oauth-state',
      );
      expect(cache.get).toHaveBeenCalledWith(
        `auth:oauth-state:${OAUTH_PROVIDER_WECHAT_WEB}:${createHash('sha256')
          .update('oauth-state')
          .digest('hex')}`,
      );
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('should reject browser callback redirect when desktop callback URI is missing', async () => {
      cache.get.mockResolvedValue({
        provider: OAUTH_PROVIDER_WECHAT_WEB,
      });

      await expect(
        service.resolveWechatWebCallbackRedirect({
          code: 'wechat-code',
          state: 'oauth-state',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(cache.del).not.toHaveBeenCalled();
    });

    it('should create a passwordless user from WeChat profile and return tokens', async () => {
      const createdUser = {
        ...mockUser,
        email: null,
        passwordHash: null,
        nickname: 'WechatUser',
        avatar: 'https://example.com/wechat-avatar.png',
      };
      const updatedUser = {
        ...createdUser,
        lastLoginAt: new Date('2026-01-02T00:00:00Z'),
      };
      cache.get.mockResolvedValue({
        provider: OAUTH_PROVIDER_WECHAT_WEB,
      });
      userService.findByIdentity.mockResolvedValue(null);
      userService.createOAuthUser.mockResolvedValue(createdUser);
      userService.update.mockResolvedValue(updatedUser);

      const result = await service.loginWithWechatWeb(
        {
          code: 'wechat-code',
          state: 'oauth-state',
        },
        mockRequestContext,
      );

      expect(cache.get).toHaveBeenCalledWith(
        `auth:oauth-state:${OAUTH_PROVIDER_WECHAT_WEB}:${createHash('sha256')
          .update('oauth-state')
          .digest('hex')}`,
      );
      expect(cache.del).toHaveBeenCalledWith(
        `auth:oauth-state:${OAUTH_PROVIDER_WECHAT_WEB}:${createHash('sha256')
          .update('oauth-state')
          .digest('hex')}`,
      );
      expect(wechatWebOAuthProvider.fetchProfile).toHaveBeenCalledWith(
        'wechat-code',
      );
      expect(userService.createOAuthUser).toHaveBeenCalledWith({
        email: null,
        nickname: 'WechatUser',
        avatar: 'https://example.com/wechat-avatar.png',
        identity: {
          provider: OAUTH_PROVIDER_WECHAT_WEB,
          providerUserId: 'wechat-openid-1',
          providerUnionId: 'wechat-unionid-1',
          email: null,
          rawProfile: { openid: 'wechat-openid-1' },
        },
      });
      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        lastLoginAt: expect.any(Date) as Date,
        status: UserStatus.active,
        nickname: 'WechatUser',
        avatar: 'https://example.com/wechat-avatar.png',
      });
      expect(result.user).toEqual(updatedUser);
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(getLastSessionCreateData(prismaService)).toEqual(
        expect.objectContaining(mockRequestContext),
      );
    });

    it('should reuse an existing identity user for WeChat login', async () => {
      const updatedUser = {
        ...mockOAuthOnlyUser,
        nickname: 'WechatUser',
        avatar: 'https://example.com/wechat-avatar.png',
        lastLoginAt: new Date('2026-01-02T00:00:00Z'),
      };
      cache.get.mockResolvedValue({
        provider: OAUTH_PROVIDER_WECHAT_WEB,
      });
      userService.findByIdentity.mockResolvedValue(mockOAuthOnlyUser);
      userService.update.mockResolvedValue(updatedUser);

      await service.loginWithWechatWeb({
        code: 'wechat-code',
        state: 'oauth-state',
      });

      expect(userService.createOAuthUser).not.toHaveBeenCalled();
      expect(userService.linkIdentity).not.toHaveBeenCalled();
      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        lastLoginAt: expect.any(Date) as Date,
        status: UserStatus.active,
        nickname: 'WechatUser',
        avatar: 'https://example.com/wechat-avatar.png',
      });
    });

    it('should reject callback when OAuth state is missing', async () => {
      cache.get.mockResolvedValue(null);

      await expect(
        service.loginWithWechatWeb({
          code: 'wechat-code',
          state: 'missing-state',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(wechatWebOAuthProvider.fetchProfile).not.toHaveBeenCalled();
    });

    it('should link mobile WeChat identity by union id and return tokens', async () => {
      const updatedUser = {
        ...mockOAuthOnlyUser,
        nickname: 'WechatMobileUser',
        avatar: 'https://example.com/wechat-mobile-avatar.png',
        lastLoginAt: new Date('2026-01-02T00:00:00Z'),
      };
      userService.findByIdentity.mockResolvedValue(null);
      userService.findByProviderUnionId.mockResolvedValue(mockOAuthOnlyUser);
      userService.linkIdentity.mockResolvedValue({
        id: 'identity-uuid-2',
        userId: mockOAuthOnlyUser.id,
        provider: OAUTH_PROVIDER_WECHAT_MOBILE,
        providerUserId: 'wechat-mobile-openid-1',
        providerUnionId: 'wechat-unionid-1',
        email: null,
        emailVerifiedAt: null,
        rawProfile: { openid: 'wechat-mobile-openid-1' },
        createdAt: new Date('2026-01-02T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });
      userService.update.mockResolvedValue(updatedUser);

      const result = await service.loginWithWechatMobile(
        { code: 'wechat-mobile-code' },
        mockRequestContext,
      );

      expect(wechatMobileOAuthProvider.fetchProfile).toHaveBeenCalledWith(
        'wechat-mobile-code',
      );
      expect(userService.findByProviderUnionId).toHaveBeenCalledWith(
        'wechat-unionid-1',
      );
      expect(userService.linkIdentity).toHaveBeenCalledWith('user-uuid-1', {
        provider: OAUTH_PROVIDER_WECHAT_MOBILE,
        providerUserId: 'wechat-mobile-openid-1',
        providerUnionId: 'wechat-unionid-1',
        email: null,
        rawProfile: { openid: 'wechat-mobile-openid-1' },
      });
      expect(userService.createOAuthUser).not.toHaveBeenCalled();
      expect(result.user).toEqual(updatedUser);
      expect(getLastSessionCreateData(prismaService)).toEqual(
        expect.objectContaining(mockRequestContext),
      );
    });
  });
});
