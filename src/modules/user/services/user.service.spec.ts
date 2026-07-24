import type { DeepMocked } from '../../../common/types/deep-mocked';
import { nonDeleted } from '../../../common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { UserStatus } from '#generated/prisma/client';

import { UserService } from './user.service';
import { PrismaService } from '../../../prisma';

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

const mockIdentity = {
  id: 'identity-uuid-1',
  userId: mockUser.id,
  provider: 'google',
  providerUserId: 'google-sub-1',
  email: mockUser.email,
  emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
  rawProfile: { sub: 'google-sub-1' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('UserService', () => {
  let service: UserService;
  let prismaService: DeepMocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findFirst: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
            },
            nonDeleted: {
              user: {
                findFirst: vi.fn(),
                findFirstOrThrow: vi.fn(),
              },
            },
            userIdentity: {
              findUnique: vi.fn(),
              findFirst: vi.fn(),
              create: vi.fn(),
              delete: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(UserService);
    prismaService = module.get(PrismaService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findById', () => {
    it('should return a user by id', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        mockUser,
      );

      const result = await service.findById('user-uuid-1');

      expect(prismaService.nonDeleted.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        null,
      );

      const result = await service.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should return a user by email', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        mockUser,
      );

      const result = await service.findByEmail('test@example.com');

      expect(prismaService.nonDeleted.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if email not found', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        null,
      );

      const result = await service.findByEmail('unknown@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findByIdentity', () => {
    it('should return the active user linked to an OAuth identity', async () => {
      (prismaService.userIdentity.findUnique as vi.Mock).mockResolvedValue({
        ...mockIdentity,
        user: mockUser,
      });

      const result = await service.findByIdentity('google', 'google-sub-1');

      expect(prismaService.userIdentity.findUnique).toHaveBeenCalledWith({
        where: {
          provider_providerUserId: {
            provider: 'google',
            providerUserId: 'google-sub-1',
          },
        },
        include: { user: true },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when identity is missing', async () => {
      (prismaService.userIdentity.findUnique as vi.Mock).mockResolvedValue(
        null,
      );

      const result = await service.findByIdentity('google', 'missing-sub');

      expect(result).toBeNull();
    });

    it('should return null when linked user is soft-deleted', async () => {
      (prismaService.userIdentity.findUnique as vi.Mock).mockResolvedValue({
        ...mockIdentity,
        user: {
          ...mockUser,
          deletedAt: new Date('2026-01-02T00:00:00Z'),
        },
      });

      const result = await service.findByIdentity('google', 'google-sub-1');

      expect(result).toBeNull();
    });
  });

  describe('findByProviderUnionId', () => {
    it('should return the earliest active user linked to a provider union id', async () => {
      (prismaService.userIdentity.findFirst as vi.Mock).mockResolvedValue({
        ...mockIdentity,
        providerUnionId: 'wechat-unionid-1',
        user: mockUser,
      });

      const result = await service.findByProviderUnionId('wechat-unionid-1');

      expect(prismaService.userIdentity.findFirst).toHaveBeenCalledWith({
        where: { providerUnionId: 'wechat-unionid-1' },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when the union-linked user is soft-deleted', async () => {
      (prismaService.userIdentity.findFirst as vi.Mock).mockResolvedValue({
        ...mockIdentity,
        providerUnionId: 'wechat-unionid-1',
        user: {
          ...mockUser,
          deletedAt: new Date('2026-01-02T00:00:00Z'),
        },
      });

      const result = await service.findByProviderUnionId('wechat-unionid-1');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a user and backfill an empty profile when one is not provided', async () => {
      (prismaService.user.create as vi.Mock).mockResolvedValue(mockUser);

      const result = await service.create({
        email: 'test@example.com',
        passwordHash: '$argon2id$mock',
        nickname: 'TestUser',
      });

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          passwordHash: '$argon2id$mock',
          nickname: 'TestUser',
          profile: { create: {} },
        },
      });
      expect(result).toEqual(mockUser);
    });

    it('should preserve an explicitly provided profile relation', async () => {
      (prismaService.user.create as vi.Mock).mockResolvedValue(mockUser);

      await service.create({
        email: 'test@example.com',
        passwordHash: '$argon2id$mock',
        profile: {
          create: {
            locale: 'zh-CN',
          },
        },
      });

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          passwordHash: '$argon2id$mock',
          profile: {
            create: {
              locale: 'zh-CN',
            },
          },
        },
      });
    });
  });

  describe('createOAuthUser', () => {
    it('should create a passwordless user with profile and provider identity', async () => {
      const verifiedAt = new Date('2026-01-02T00:00:00Z');
      const oauthUser = {
        ...mockUser,
        passwordHash: null,
        emailVerifiedAt: verifiedAt,
      };
      (prismaService.user.create as vi.Mock).mockResolvedValue(oauthUser);

      const result = await service.createOAuthUser({
        email: 'test@example.com',
        nickname: 'TestUser',
        avatar: null,
        emailVerifiedAt: verifiedAt,
        identity: {
          provider: 'google',
          providerUserId: 'google-sub-1',
          email: 'test@example.com',
          emailVerifiedAt: verifiedAt,
          rawProfile: { sub: 'google-sub-1' },
        },
      });

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          passwordHash: null,
          nickname: 'TestUser',
          avatar: null,
          emailVerifiedAt: verifiedAt,
          profile: { create: {} },
          identities: {
            create: {
              provider: 'google',
              providerUserId: 'google-sub-1',
              email: 'test@example.com',
              emailVerifiedAt: verifiedAt,
              rawProfile: { sub: 'google-sub-1' },
            },
          },
        },
      });
      expect(result).toEqual(oauthUser);
    });

    it('should create an OAuth user without email for providers that do not expose one', async () => {
      const oauthUser = {
        ...mockUser,
        email: null,
        passwordHash: null,
        nickname: 'WechatUser',
        avatar: 'https://example.com/avatar.png',
      };
      (prismaService.user.create as vi.Mock).mockResolvedValue(oauthUser);

      const result = await service.createOAuthUser({
        nickname: 'WechatUser',
        avatar: 'https://example.com/avatar.png',
        identity: {
          provider: 'wechat_web',
          providerUserId: 'wechat-openid-1',
          providerUnionId: 'wechat-unionid-1',
          email: null,
          rawProfile: { openid: 'wechat-openid-1' },
        },
      });

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          passwordHash: null,
          nickname: 'WechatUser',
          avatar: 'https://example.com/avatar.png',
          profile: { create: {} },
          identities: {
            create: {
              provider: 'wechat_web',
              providerUserId: 'wechat-openid-1',
              providerUnionId: 'wechat-unionid-1',
              email: null,
              rawProfile: { openid: 'wechat-openid-1' },
            },
          },
        },
      });
      expect(result).toEqual(oauthUser);
    });
  });

  describe('linkIdentity', () => {
    it('should attach a provider identity to an existing user', async () => {
      (prismaService.userIdentity.create as vi.Mock).mockResolvedValue(
        mockIdentity,
      );

      const result = await service.linkIdentity('user-uuid-1', {
        provider: 'google',
        providerUserId: 'google-sub-1',
        providerUnionId: 'google-union-1',
        email: 'test@example.com',
      });

      expect(prismaService.userIdentity.create).toHaveBeenCalledWith({
        data: {
          provider: 'google',
          providerUserId: 'google-sub-1',
          providerUnionId: 'google-union-1',
          email: 'test@example.com',
          user: { connect: { id: 'user-uuid-1' } },
        },
      });
      expect(result).toEqual(mockIdentity);
    });
  });

  describe('findByIdWithIdentities', () => {
    it('should return the user with identities ordered by creation time', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue({
        ...mockUser,
        identities: [mockIdentity],
      });

      const result = await service.findByIdWithIdentities('user-uuid-1');

      expect(prismaService.nonDeleted.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        include: { identities: { orderBy: { createdAt: 'asc' } } },
      });
      expect(result).toEqual({ ...mockUser, identities: [mockIdentity] });
    });

    it('should return null if user not found', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        null,
      );

      const result = await service.findByIdWithIdentities('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('unlinkIdentity', () => {
    it('should delete the identity row by id', async () => {
      (prismaService.userIdentity.delete as vi.Mock).mockResolvedValue(
        mockIdentity,
      );

      await service.unlinkIdentity('identity-uuid-1');

      expect(prismaService.userIdentity.delete).toHaveBeenCalledWith({
        where: { id: 'identity-uuid-1' },
      });
    });
  });

  describe('update', () => {
    it('should update user by id', async () => {
      const updatedUser = { ...mockUser, nickname: 'UpdatedName' };
      (prismaService.user.update as vi.Mock).mockResolvedValue(updatedUser);

      const result = await service.update('user-uuid-1', {
        nickname: 'UpdatedName',
      });

      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { nickname: 'UpdatedName' },
      });
      expect(result.nickname).toBe('UpdatedName');
    });
  });

  describe('updateByEmail', () => {
    it('should find the active user first, then update by id', async () => {
      const updatedUser = {
        ...mockUser,
        emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
      };
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        mockUser,
      );
      (prismaService.user.update as vi.Mock).mockResolvedValue(updatedUser);

      const result = await service.updateByEmail('test@example.com', {
        emailVerifiedAt: updatedUser.emailVerifiedAt,
      });

      expect(prismaService.nonDeleted.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { emailVerifiedAt: updatedUser.emailVerifiedAt },
      });
      expect(result?.emailVerifiedAt).toEqual(updatedUser.emailVerifiedAt);
    });

    it('should return null when no active user matches the email', async () => {
      (prismaService.nonDeleted.user.findFirst as vi.Mock).mockResolvedValue(
        null,
      );

      const result = await service.updateByEmail('missing@example.com', {
        emailVerifiedAt: new Date(),
      });

      expect(prismaService.user.update).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
});
