import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { AuthOAuthService } from './oauth.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { Prisma, type User } from '#generated/prisma/client';
import { UserStatus } from '#generated/prisma/client';
import type { Account } from '#generated/prisma/client';
import {
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';
import type { OAuthProfile } from '../../types/oauth.types';

// ── Fixtures ──────────────────────────────────────────────────

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  emailVerified: true,
  nickname: 'OAuthUser',
  avatar: 'https://example.com/avatar.jpg',
  status: UserStatus.active,
  emailVerifiedAt: null,
  lastLoginAt: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const mockAccount: Account = {
  id: 'account-1',
  userId: 'user-1',
  issuer: 'wechat_web',
  providerId: 'wechat_web',
  accountId: 'wx-openid-123',
  providerUnionId: 'wx-union-456',
  providerEmail: 'wxuser@example.com',
  providerEmailVerifiedAt: new Date(),
  rawProfile: null,
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  scope: null,
  password: null,
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
  provider: 'google',
  providerUserId: 'google-sub-789',
  email: 'google@example.com',
  emailVerifiedAt: new Date(),
  nickname: 'Google User',
  avatar: 'https://lh3.googleusercontent.com/photo',
} as OAuthProfile;

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  const error = Object.create(
    Prisma.PrismaClientKnownRequestError.prototype,
  ) as Prisma.PrismaClientKnownRequestError;
  error.code = code;
  return error;
}

/** Folds a ResultAsync into a plain outcome so specs can assert code/value. */
function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

// ── Suite ─────────────────────────────────────────────────────

type MockedPrisma = {
  account: {
    findFirst: vi.Mock;
    create: vi.Mock;
  };
  user: {
    findFirst: vi.Mock;
    create: vi.Mock;
    update: vi.Mock;
  };
  $transaction: vi.Mock;
};

describe('AuthOAuthService', () => {
  let service: AuthOAuthService;
  let prisma: MockedPrisma;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthOAuthService,
        {
          provide: PrismaService,
          useValue: {
            account: {
              findFirst: vi.fn(),
              create: vi.fn(),
            },
            user: {
              findFirst: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
            },
            $transaction: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthOAuthService);
    prisma = module.get(PrismaService) as unknown as MockedPrisma;

    prisma.account.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(mockUser);
    prisma.user.update.mockResolvedValue(mockUser);
    prisma.account.create.mockResolvedValue(mockAccount);

    const runTransaction = async <T>(
      callback: (tx: MockedPrisma) => Promise<T>,
    ): Promise<T> => callback(prisma);
    prisma.$transaction.mockImplementation(runTransaction);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('findOrCreateOAuthUser', () => {
    it('should return existing user matched by identity', async () => {
      prisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        user: mockUser,
      });
      const outcome = await collectResult(
        service.findOrCreateOAuthUser(wechatProfile),
      );
      expect(outcome).toEqual({ ok: true, value: mockUser });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('should create new user when no identity exists', async () => {
      const outcome = await collectResult(
        service.findOrCreateOAuthUser(googleProfile),
      );
      expect(outcome.ok).toBe(true);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'google@example.com',
            nickname: 'Google User',
            profile: { create: {} },
          }),
        }),
      );
      expect(prisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'google',
            accountId: 'google-sub-789',
            user: { connect: { id: 'user-1' } },
          }),
        }),
      );
    });

    it('should match by unionId when providerUserId not found', async () => {
      prisma.account.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...mockAccount, user: mockUser });
      const outcome = await collectResult(
        service.findOrCreateOAuthUser(wechatProfile),
      );
      expect(outcome).toEqual({ ok: true, value: mockUser });
      expect(prisma.account.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          providerUnionId: 'wx-union-456',
          user: { deletedAt: null },
        },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(prisma.account.create).toHaveBeenCalled();
    });

    it('should match by email when no unionId match exists', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      const outcome = await collectResult(
        service.findOrCreateOAuthUser(wechatProfile),
      );
      expect(outcome).toEqual({ ok: true, value: mockUser });
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          email: 'wxuser@example.com',
          deletedAt: null,
        },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.account.create).toHaveBeenCalled();
    });

    it('should not link by email when email is unverified', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      const unverifiedProfile: OAuthProfile = {
        ...googleProfile,
        emailVerifiedAt: null,
      };

      const outcome = await collectResult(
        service.findOrCreateOAuthUser(unverifiedProfile),
      );

      expect(outcome.ok).toBe(true);
      expect(prisma.user.findFirst).toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.account.create).toHaveBeenCalled();
    });

    it('should rethrow database failures instead of masking them', async () => {
      prisma.account.findFirst.mockRejectedValue(
        new Error('db connection lost'),
      );

      await expect(
        collectResult(service.findOrCreateOAuthUser(wechatProfile)),
      ).rejects.toThrow('db connection lost');
    });

    it('should map a create race (P2002) to RESOURCE_CONFLICT', async () => {
      prisma.$transaction.mockRejectedValue(prismaError('P2002'));

      const outcome = await collectResult(
        service.findOrCreateOAuthUser(googleProfile),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
    });
  });

  describe('updateOAuthLoginUser', () => {
    it('should update lastLoginAt, status, nickname and avatar on OAuth login', async () => {
      const outcome = await collectResult(
        service.updateOAuthLoginUser(mockUser, wechatProfile),
      );

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            lastLoginAt: expect.any(Date),
            status: UserStatus.active,
            nickname: 'WeChat User',
            avatar: 'https://wx.qlogo.cn/avatar',
          }),
        }),
      );
      expect(outcome).toEqual({ ok: true, value: mockUser });
    });

    it('should propagate a RESOURCE_NOT_FOUND update failure', async () => {
      prisma.user.update.mockRejectedValue(prismaError('P2025'));

      const outcome = await collectResult(
        service.updateOAuthLoginUser(mockUser, wechatProfile),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
      });
    });
  });

  describe('linkOAuthProfileToUser', () => {
    it('should link OAuth identity to existing user', async () => {
      const outcome = await collectResult(
        service.linkOAuthProfileToUser('user-1', wechatProfile),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(prisma.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'wechat_web',
            accountId: 'wx-openid-123',
            user: { connect: { id: 'user-1' } },
          }),
        }),
      );
    });

    it('should reject linking Better Auth-managed providers', async () => {
      const outcome = await collectResult(
        service.linkOAuthProfileToUser('user-1', googleProfile),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
      expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('should reject when identity already linked to another user', async () => {
      prisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        user: { ...mockUser, id: 'other-user' },
      });

      const outcome = await collectResult(
        service.linkOAuthProfileToUser('user-1', wechatProfile),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
      expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('should reject when unionId already linked to another user', async () => {
      prisma.account.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...mockAccount,
          user: { ...mockUser, id: 'other-user' },
        });

      const outcome = await collectResult(
        service.linkOAuthProfileToUser('user-1', wechatProfile),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
      expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('should be a no-op when the identity is already linked to the same user', async () => {
      prisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        user: mockUser,
      });

      const outcome = await collectResult(
        service.linkOAuthProfileToUser('user-1', wechatProfile),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it('should map a link race (P2002) to RESOURCE_CONFLICT', async () => {
      prisma.account.create.mockRejectedValue(prismaError('P2002'));

      const outcome = await collectResult(
        service.linkOAuthProfileToUser('user-1', wechatProfile),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
    });

    it('should rethrow database failures instead of masking them', async () => {
      prisma.account.findFirst.mockRejectedValue(
        new Error('db connection lost'),
      );

      await expect(
        collectResult(service.linkOAuthProfileToUser('user-1', wechatProfile)),
      ).rejects.toThrow('db connection lost');
    });
  });
});
