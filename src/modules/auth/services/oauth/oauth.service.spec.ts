import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { AuthOAuthService } from './oauth.service';
import { UserService } from '../../../user';
import { Prisma, type User } from '#generated/prisma/client';
import { UserStatus } from '#generated/prisma/client';
import type { UserIdentity } from '#generated/prisma/client';
import {
  createDomainFailure,
  errAsync,
  okAsync,
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

describe('AuthOAuthService', () => {
  let service: AuthOAuthService;
  let userService: vi.Mocked<UserService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthOAuthService,
        {
          provide: UserService,
          useValue: {
            findByIdentity: vi.fn(),
            findByEmail: vi.fn(),
            findByProviderUnionId: vi.fn(),
            createOAuthUser: vi.fn(),
            update: vi.fn(),
            linkIdentity: vi.fn(),
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
    userService.update.mockReturnValue(okAsync(mockUser));
    userService.linkIdentity.mockResolvedValue(mockIdentity);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('findOrCreateOAuthUser', () => {
    it('should return existing user matched by identity', async () => {
      userService.findByIdentity.mockResolvedValue(mockUser);
      const outcome = await collectResult(
        service.findOrCreateOAuthUser(wechatProfile),
      );
      expect(outcome).toEqual({ ok: true, value: mockUser });
      expect(userService.createOAuthUser).not.toHaveBeenCalled();
    });

    it('should create new user when no identity exists', async () => {
      const outcome = await collectResult(
        service.findOrCreateOAuthUser(googleProfile),
      );
      expect(outcome.ok).toBe(true);
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
    });

    it('should match by unionId when providerUserId not found', async () => {
      userService.findByProviderUnionId.mockResolvedValue(mockUser);
      const outcome = await collectResult(
        service.findOrCreateOAuthUser(wechatProfile),
      );
      expect(outcome).toEqual({ ok: true, value: mockUser });
      expect(userService.findByProviderUnionId).toHaveBeenCalledWith(
        'wx-union-456',
      );
    });

    it('should match by email when no unionId match exists', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      const outcome = await collectResult(
        service.findOrCreateOAuthUser(wechatProfile),
      );
      expect(outcome).toEqual({ ok: true, value: mockUser });
      expect(userService.findByEmail).toHaveBeenCalledWith(
        'wxuser@example.com',
      );
      expect(userService.createOAuthUser).not.toHaveBeenCalled();
    });

    it('should rethrow database failures instead of masking them', async () => {
      userService.findByIdentity.mockRejectedValue(
        new Error('db connection lost'),
      );

      await expect(
        collectResult(service.findOrCreateOAuthUser(wechatProfile)),
      ).rejects.toThrow('db connection lost');
    });

    it('should map a create race (P2002) to RESOURCE_CONFLICT', async () => {
      userService.createOAuthUser.mockRejectedValue(prismaError('P2002'));

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

      expect(userService.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          lastLoginAt: expect.any(Date),
          status: UserStatus.active,
          nickname: 'WeChat User',
          avatar: 'https://wx.qlogo.cn/avatar',
        }),
      );
      expect(outcome).toEqual({ ok: true, value: mockUser });
    });

    it('should propagate a RESOURCE_NOT_FOUND update failure', async () => {
      userService.update.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'not_found',
            code: 'RESOURCE_NOT_FOUND',
          }),
        ),
      );

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

      const outcome = await collectResult(
        service.linkOAuthProfileToUser('user-1', wechatProfile),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
      expect(userService.linkIdentity).not.toHaveBeenCalled();
    });

    it('should reject when unionId already linked to another user', async () => {
      userService.findByProviderUnionId.mockResolvedValue({
        ...mockUser,
        id: 'other-user',
      });

      const outcome = await collectResult(
        service.linkOAuthProfileToUser('user-1', wechatProfile),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
      expect(userService.linkIdentity).not.toHaveBeenCalled();
    });

    it('should be a no-op when the identity is already linked to the same user', async () => {
      userService.findByIdentity.mockResolvedValue(mockUser);

      const outcome = await collectResult(
        service.linkOAuthProfileToUser('user-1', wechatProfile),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(userService.linkIdentity).not.toHaveBeenCalled();
    });

    it('should map a link race (P2002) to RESOURCE_CONFLICT', async () => {
      userService.linkIdentity.mockRejectedValue(prismaError('P2002'));

      const outcome = await collectResult(
        service.linkOAuthProfileToUser('user-1', wechatProfile),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
    });

    it('should rethrow database failures instead of masking them', async () => {
      userService.findByIdentity.mockRejectedValue(
        new Error('db connection lost'),
      );

      await expect(
        collectResult(service.linkOAuthProfileToUser('user-1', wechatProfile)),
      ).rejects.toThrow('db connection lost');
    });
  });
});
