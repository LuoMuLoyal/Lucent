import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { AuthOAuthService } from './auth-oauth.service';
import { UserService } from '../../user/services/user.service';
import type { User } from '../../../generated/prisma/client';
import { UserStatus } from '../../../generated/prisma/client';
import type { UserIdentity } from '../../../generated/prisma/client';
import type { OAuthProfile } from '../types/oauth.types';

// ── Fixtures ──────────────────────────────────────────────────

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  passwordHash: null,
  nickname: 'OAuthUser',
  avatar: 'https://example.com/avatar.jpg',
  status: UserStatus.active,
  emailVerifiedAt: null,
  lastLoginAt: null,
  twoFactorEnabled: false,
  twoFactorSecret: null,
  twoFactorRecoveryCodes: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const mockIdentity: UserIdentity = {
  id: 'identity-1',
  userId: 'user-1',
  provider: 'wechat_web',
  providerUserId: 'wx-openid-123',
  providerUnionId: 'wx-union-456',
  email: 'wxuser@example.com',
  emailVerifiedAt: new Date(),
  rawProfile: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const wechatProfile: OAuthProfile = {
  provider: 'wechat_web',
  providerUserId: 'wx-openid-123',
  unionId: 'wx-union-456',
  email: 'wxuser@example.com',
  emailVerifiedAt: new Date(),
  nickname: 'WeChat User',
  avatar: 'https://wx.qlogo.cn/avatar',
};

const googleProfile = {
  provider: 'wechat_web',
  providerUserId: 'wechat-sub-789',
  email: 'google@example.com',
  emailVerifiedAt: new Date(),
  nickname: 'Google User',
  avatar: 'https://lh3.googleusercontent.com/photo',
} as OAuthProfile;

// ── Suite ─────────────────────────────────────────────────────

describe('AuthOAuthService', () => {
  let service: AuthOAuthService;
  let userService: jest.Mocked<UserService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthOAuthService,
        {
          provide: UserService,
          useValue: {
            findByIdentity: jest.fn(),
            findByEmail: jest.fn(),
            findByProviderUnionId: jest.fn(),
            createOAuthUser: jest.fn(),
            update: jest.fn(),
            linkIdentity: jest.fn(),
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

    service = module.get(AuthOAuthService);
    userService = module.get(UserService);

    userService.findByIdentity.mockResolvedValue(null);
    userService.findByEmail.mockResolvedValue(null);
    userService.findByProviderUnionId.mockResolvedValue(null);
    userService.createOAuthUser.mockResolvedValue(mockUser);
    userService.update.mockResolvedValue(mockUser);
    userService.linkIdentity.mockResolvedValue(mockIdentity);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('findOrCreateOAuthUser', () => {
    it('should return existing user matched by identity', async () => {
      userService.findByIdentity.mockResolvedValue(mockUser);
      const result = await service.findOrCreateOAuthUser(wechatProfile);
      expect(result).toBe(mockUser);
      expect(userService.createOAuthUser).not.toHaveBeenCalled();
    });

    it('should create new user when no identity exists', async () => {
      const result = await service.findOrCreateOAuthUser(googleProfile);
      expect(userService.createOAuthUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'google@example.com',
          nickname: 'Google User',
          identity: expect.objectContaining({
            provider: 'wechat_web',
            providerUserId: 'wechat-sub-789',
          }),
        }),
      );
      expect(result).toBe(mockUser);
    });

    it('should match by unionId when providerUserId not found', async () => {
      userService.findByProviderUnionId.mockResolvedValue(mockUser);
      const result = await service.findOrCreateOAuthUser(wechatProfile);
      expect(result).toBe(mockUser);
      expect(userService.findByProviderUnionId).toHaveBeenCalledWith(
        'wx-union-456',
      );
    });
  });

  describe('updateOAuthLoginUser', () => {
    it('should update lastLoginAt, status, nickname and avatar on OAuth login', async () => {
      const result = await service.updateOAuthLoginUser(
        mockUser,
        wechatProfile,
      );
      expect(userService.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          lastLoginAt: expect.any(Date),
          status: UserStatus.active,
          nickname: 'WeChat User',
          avatar: 'https://wx.qlogo.cn/avatar',
        }),
      );
      expect(result).toBe(mockUser);
    });
  });

  describe('linkOAuthProfileToUser', () => {
    it('should link OAuth identity to existing user', async () => {
      await service.linkOAuthProfileToUser('user-1', wechatProfile);
      expect(userService.linkIdentity).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          provider: 'wechat_web',
          providerUserId: 'wx-openid-123',
        }),
      );
    });

    it('should reject when identity already linked to another user', async () => {
      userService.findByIdentity.mockResolvedValue({
        ...mockUser,
        id: 'other-user',
      });
      await expect(
        service.linkOAuthProfileToUser('user-1', wechatProfile),
      ).rejects.toThrow(HttpException);
    });
  });
});
