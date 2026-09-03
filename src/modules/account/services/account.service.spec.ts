import type { DeepMocked } from '../../../common/types/deep-mocked.js';
import { nonDeleted } from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  okAsync,
} from '../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { I18nService } from 'nestjs-i18n';
import { UserStatus } from '#generated/prisma/client.js';

import { AccountService } from './account.service.js';
import {
  AuthBetterAuthAdapter,
  PasswordReauthService,
} from '../../auth/index.js';
import { UserService } from '../../user/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { UpdateAccountDto } from '../dto/update.dto.js';

const baseUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  nickname: 'TestUser',
  avatar: 'https://example.com/avatar.png',
  status: UserStatus.active,
  emailVerifiedAt: new Date('2026-01-15T10:30:00.000Z'),
  lastLoginAt: new Date('2026-06-10T08:00:00.000Z'),
  ...nonDeleted,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-10T12:00:00.000Z'),
};

const baseIdentity = {
  id: 'identity-uuid-1',
  userId: baseUser.id,
  issuer: 'wechat_web',
  providerId: 'wechat_web',
  accountId: 'wx-openid-xxx',
  providerUnionId: null,
  providerEmail: 'wechat-bound@example.com',
  providerEmailVerifiedAt: new Date('2026-01-15T10:30:00.000Z'),
  rawProfile: { sub: 'wx-openid-xxx' },
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  scope: null,
  password: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const secondIdentity = {
  id: 'identity-uuid-2',
  userId: baseUser.id,
  issuer: 'google',
  providerId: 'google',
  accountId: 'google-sub-yyy',
  providerUnionId: null,
  providerEmail: 'google-bound@example.com',
  providerEmailVerifiedAt: null,
  rawProfile: { sub: 'google-sub-yyy' },
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  scope: null,
  password: null,
  createdAt: new Date('2026-02-01T00:00:00.000Z'),
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
};

async function inspectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

type MockedPrisma = {
  $transaction: vi.Mock;
  account: {
    findMany: vi.Mock;
    deleteMany: vi.Mock;
  };
};

describe('AccountService', () => {
  let service: AccountService;
  let userService: DeepMocked<UserService>;
  let prisma: MockedPrisma;
  let passwordReauthService: vi.Mocked<PasswordReauthService>;
  let betterAuthAdapter: vi.Mocked<AuthBetterAuthAdapter>;
  let module: TestingModule;

  beforeEach(async () => {
    const prismaMock: MockedPrisma = {
      $transaction: vi.fn(async (cb: (tx: MockedPrisma) => Promise<unknown>) =>
        // Pass the same prismaMock as the transaction client so the test's
        // mock return values on account.findMany/deleteMany are visible
        // inside the transaction callback.
        cb(prismaMock),
      ),
      account: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
    };

    module = await Test.createTestingModule({
      providers: [
        {
          provide: I18nService,
          useValue: { t: vi.fn().mockImplementation((key: string) => key) },
        },
        AccountService,
        {
          provide: UserService,
          useValue: {
            findById: vi.fn(),
            update: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: PasswordReauthService,
          useValue: {
            verify: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: AuthBetterAuthAdapter,
          useValue: {
            hasPassword: vi.fn().mockReturnValue(okAsync(true)),
            revokeBetterAuthSessions: vi
              .fn()
              .mockReturnValue(okAsync(undefined)),
          },
        },
      ],
    }).compile();

    service = module.get(AccountService);
    userService = module.get(UserService);
    prisma = module.get(PrismaService) as unknown as MockedPrisma;
    passwordReauthService = module.get(PasswordReauthService);
    betterAuthAdapter = module.get(AuthBetterAuthAdapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAccount', () => {
    it('should return the account DTO for an active user', async () => {
      (userService.findById as vi.Mock).mockResolvedValue(baseUser);
      prisma.account.findMany.mockResolvedValue([baseIdentity]);

      const result = await inspectResult(service.getAccount(baseUser.id));

      expect(userService.findById).toHaveBeenCalledWith(baseUser.id);
      expect(prisma.account.findMany).toHaveBeenCalledWith({
        where: { userId: baseUser.id, providerId: { not: 'credential' } },
        orderBy: { createdAt: 'asc' },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value).toEqual({
        id: baseUser.id,
        email: baseUser.email,
        nickname: baseUser.nickname,
        avatar: baseUser.avatar,
        emailVerifiedAt: '2026-01-15T10:30:00.000Z',
        hasPassword: true,
        lastLoginAt: '2026-06-10T08:00:00.000Z',
        linkedIdentities: [
          {
            id: baseIdentity.id,
            provider: baseIdentity.providerId,
            email: baseIdentity.providerEmail,
            emailVerifiedAt: '2026-01-15T10:30:00.000Z',
            linkedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-06-10T12:00:00.000Z',
      });
    });

    it('should return a not-found DomainFailure when the user does not exist', async () => {
      (userService.findById as vi.Mock).mockResolvedValue(null);

      const result = await inspectResult(service.getAccount('missing-user'));

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('should set hasPassword to false when there is no credential account', async () => {
      (betterAuthAdapter.hasPassword as vi.Mock).mockReturnValueOnce(
        okAsync(false),
      );
      (userService.findById as vi.Mock).mockResolvedValue(baseUser);
      prisma.account.findMany.mockResolvedValue([baseIdentity]);

      const result = await inspectResult(service.getAccount(baseUser.id));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.hasPassword).toBe(false);
    });

    it('maps unexpected user-service failures to DEPENDENCY_UNAVAILABLE', async () => {
      const error = new Error('database unavailable');
      (userService.findById as vi.Mock).mockRejectedValue(error);

      const result = await inspectResult(service.getAccount('db-failure'));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(result.error.cause).toBe(error);
    });

    it('should return null fields when dates are null', async () => {
      (userService.findById as vi.Mock).mockResolvedValue({
        ...baseUser,
        emailVerifiedAt: null,
        lastLoginAt: null,
        avatar: null,
        nickname: null,
      });
      prisma.account.findMany.mockResolvedValue([
        { ...baseIdentity, providerEmailVerifiedAt: null },
      ]);

      const result = await inspectResult(service.getAccount(baseUser.id));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.emailVerifiedAt).toBeNull();
      expect(result.value.lastLoginAt).toBeNull();
      expect(result.value.avatar).toBeNull();
      expect(result.value.nickname).toBeNull();
      const firstIdentity = result.value.linkedIdentities[0];
      if (!firstIdentity) throw new Error('no identity');
      expect(firstIdentity.emailVerifiedAt).toBeNull();
    });
  });

  describe('updateAccount', () => {
    it('should update nickname and avatar', async () => {
      (userService.findById as vi.Mock)
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce({
          ...baseUser,
          nickname: 'NewNick',
          avatar: 'https://example.com/new-avatar.png',
        });
      prisma.account.findMany
        .mockResolvedValueOnce([baseIdentity])
        .mockResolvedValueOnce([baseIdentity]);
      (userService.update as vi.Mock).mockReturnValue(okAsync(undefined));

      const dto: UpdateAccountDto = {
        nickname: 'NewNick',
        avatar: 'https://example.com/new-avatar.png',
      };

      const result = await inspectResult(
        service.updateAccount(baseUser.id, dto),
      );

      expect(userService.update).toHaveBeenCalledWith(baseUser.id, {
        nickname: 'NewNick',
        avatar: 'https://example.com/new-avatar.png',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.nickname).toBe('NewNick');
      expect(result.value.avatar).toBe('https://example.com/new-avatar.png');
    });

    it('should normalize empty string to null for clearing', async () => {
      (userService.findById as vi.Mock)
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce({
          ...baseUser,
          nickname: null,
          avatar: null,
        });
      prisma.account.findMany
        .mockResolvedValueOnce([baseIdentity])
        .mockResolvedValueOnce([baseIdentity]);
      (userService.update as vi.Mock).mockReturnValue(okAsync(undefined));

      const dto: UpdateAccountDto = { nickname: '', avatar: '' };

      const result = await inspectResult(
        service.updateAccount(baseUser.id, dto),
      );

      expect(userService.update).toHaveBeenCalledWith(baseUser.id, {
        nickname: null,
        avatar: null,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.nickname).toBeNull();
      expect(result.value.avatar).toBeNull();
    });

    it('should skip fields that are undefined', async () => {
      (userService.findById as vi.Mock)
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce(baseUser);
      prisma.account.findMany
        .mockResolvedValueOnce([baseIdentity])
        .mockResolvedValueOnce([baseIdentity]);
      (userService.update as vi.Mock).mockReturnValue(okAsync(undefined));

      const dto: UpdateAccountDto = {};

      const result = await inspectResult(
        service.updateAccount(baseUser.id, dto),
      );

      expect(userService.update).toHaveBeenCalledWith(baseUser.id, {});
      expect(result.ok).toBe(true);
    });

    it('should return a not-found DomainFailure when user does not exist', async () => {
      (userService.findById as vi.Mock).mockResolvedValue(null);

      const result = await inspectResult(
        service.updateAccount('missing-user', { nickname: 'X' }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  describe('unlinkIdentity', () => {
    it('should unlink an identity when user has password', async () => {
      (userService.findById as vi.Mock)
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce(baseUser);
      // 3 calls to findMany: getActiveAccountUser, tx re-check, getAccount
      prisma.account.findMany
        .mockResolvedValueOnce([baseIdentity, secondIdentity])
        .mockResolvedValueOnce([baseIdentity, secondIdentity])
        .mockResolvedValueOnce([secondIdentity]);
      prisma.account.deleteMany.mockResolvedValue({ count: 1 });

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'Passw0rd123',
        }),
      );

      expect(passwordReauthService.verify).toHaveBeenCalledWith(
        baseUser.id,
        'Passw0rd123',
      );
      expect(prisma.account.deleteMany).toHaveBeenCalledWith({
        where: {
          id: baseIdentity.id,
          userId: baseUser.id,
          providerId: { not: 'credential' },
        },
      });
      expect(betterAuthAdapter.revokeBetterAuthSessions).toHaveBeenCalledWith(
        baseUser.id,
        expect.anything(),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.linkedIdentities).toHaveLength(1);
      const firstIdentity = result.value.linkedIdentities[0];
      if (!firstIdentity) throw new Error('no identity');
      expect(firstIdentity.id).toBe(secondIdentity.id);
    });

    it('should return AUTH_WRONG_PASSWORD when password verification fails', async () => {
      (userService.findById as vi.Mock).mockResolvedValueOnce(baseUser);
      prisma.account.findMany.mockResolvedValueOnce([
        baseIdentity,
        secondIdentity,
      ]);
      passwordReauthService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_WRONG_PASSWORD',
          }),
        ),
      );

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'WrongPass1',
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'authentication', code: 'AUTH_WRONG_PASSWORD' },
      });
      expect(prisma.account.deleteMany).not.toHaveBeenCalled();
    });

    it('should return AUTH_PASSWORD_NOT_SET for OAuth-only users', async () => {
      (userService.findById as vi.Mock).mockResolvedValueOnce(baseUser);
      prisma.account.findMany.mockResolvedValueOnce([
        baseIdentity,
        secondIdentity,
      ]);
      passwordReauthService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_PASSWORD_NOT_SET',
          }),
        ),
      );

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'AnyPass1',
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'authentication', code: 'AUTH_PASSWORD_NOT_SET' },
      });
      expect(prisma.account.deleteMany).not.toHaveBeenCalled();
    });

    it('should return an authorization DomainFailure when unlinking the last sign-in method', async () => {
      (betterAuthAdapter.hasPassword as vi.Mock).mockReturnValueOnce(
        okAsync(false),
      );
      (userService.findById as vi.Mock).mockResolvedValueOnce(baseUser);
      prisma.account.findMany.mockResolvedValueOnce([baseIdentity]);

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'Passw0rd123',
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'authorization', code: 'FORBIDDEN' },
      });
    });

    it('should allow unlinking when user has password even with only one identity', async () => {
      (userService.findById as vi.Mock)
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce(baseUser);
      // 3 calls: getActiveAccountUser, tx re-check, getAccount
      prisma.account.findMany
        .mockResolvedValueOnce([baseIdentity])
        .mockResolvedValueOnce([baseIdentity])
        .mockResolvedValueOnce([]);
      prisma.account.deleteMany.mockResolvedValue({ count: 1 });

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'Passw0rd123',
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.linkedIdentities).toHaveLength(0);
    });

    it('should return a not-found DomainFailure when identity does not exist', async () => {
      (userService.findById as vi.Mock).mockResolvedValueOnce(baseUser);
      prisma.account.findMany.mockResolvedValueOnce([baseIdentity]);

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, 'nonexistent-identity', {
          password: 'Passw0rd123',
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('should allow unlinking when password verification succeeds and multiple identities remain', async () => {
      (betterAuthAdapter.hasPassword as vi.Mock).mockReturnValueOnce(
        okAsync(false),
      );
      (userService.findById as vi.Mock)
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce(baseUser);
      // 3 calls: getActiveAccountUser, tx re-check, getAccount
      prisma.account.findMany
        .mockResolvedValueOnce([baseIdentity, secondIdentity])
        .mockResolvedValueOnce([baseIdentity, secondIdentity])
        .mockResolvedValueOnce([secondIdentity]);
      prisma.account.deleteMany.mockResolvedValue({ count: 1 });

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'Passw0rd123',
        }),
      );

      expect(prisma.account.deleteMany).toHaveBeenCalledWith({
        where: {
          id: baseIdentity.id,
          userId: baseUser.id,
          providerId: { not: 'credential' },
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.linkedIdentities).toHaveLength(1);
    });

    it('should return not-found when deleteMany removes no rows', async () => {
      (userService.findById as vi.Mock).mockResolvedValueOnce(baseUser);
      // 2 calls: getActiveAccountUser, tx re-check
      prisma.account.findMany
        .mockResolvedValueOnce([baseIdentity, secondIdentity])
        .mockResolvedValueOnce([baseIdentity, secondIdentity]);
      prisma.account.deleteMany.mockResolvedValue({ count: 0 });

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'Passw0rd123',
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('should propagate the hasPassword Err path inside the transaction (C-1)', async () => {
      // The first hasPassword call (pre-transaction) returns true so the
      // initial guard passes. The second call (inside the transaction) returns
      // a DomainFailure Err — this must propagate as a dependency failure,
      // NOT be silently folded into `false` (which would incorrectly trigger
      // the FORBIDDEN guard).
      (betterAuthAdapter.hasPassword as vi.Mock)
        .mockReturnValueOnce(okAsync(true)) // pre-transaction check
        .mockReturnValueOnce(
          errAsync(
            createDomainFailure({
              kind: 'dependency',
              code: 'DEPENDENCY_UNAVAILABLE',
            }),
          ),
        ); // in-transaction check → Err
      (userService.findById as vi.Mock).mockResolvedValueOnce(baseUser);
      prisma.account.findMany.mockResolvedValueOnce([
        baseIdentity,
        secondIdentity,
      ]);
      prisma.account.deleteMany.mockResolvedValue({ count: 1 });

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'Passw0rd123',
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'dependency', code: 'DEPENDENCY_UNAVAILABLE' },
      });
      // deleteMany must NOT be called because the transaction was rolled back
      // by the DomainFailureException thrown from the hasPassword Err path.
      expect(prisma.account.deleteMany).not.toHaveBeenCalled();
    });
  });
});
