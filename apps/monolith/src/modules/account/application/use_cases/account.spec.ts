import type { DeepMocked } from '../../../../common/types/deep-mocked.js';
import { nonDeleted } from '../../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  okAsync,
} from '../../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { I18nService } from 'nestjs-i18n';
import { UserStatus } from '#generated/prisma/client.js';

import { Account } from './account.js';
import { AccountIdentity } from '../ports/account-identity.js';
import { UserService } from '../../../user/index.js';
import {
  IdentityUnlinkRejected,
  LinkedIdentities,
} from '../ports/linked-identities.js';
import type { UpdateAccountCommand as UpdateAccountDto } from '../ports/update-account.js';

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

type MockedIdentities = {
  listForUser: vi.Mock;
  unlinkInTransaction: vi.Mock;
};

describe('Account', () => {
  let service: Account;
  let userService: DeepMocked<UserService>;
  let identities: MockedIdentities;
  let identity: vi.Mocked<AccountIdentity>;

  let module: TestingModule;

  beforeEach(async () => {
    const identitiesMock: MockedIdentities = {
      listForUser: vi.fn(),
      unlinkInTransaction: vi.fn().mockResolvedValue(undefined),
    };

    module = await Test.createTestingModule({
      providers: [
        {
          provide: I18nService,
          useValue: { t: vi.fn().mockImplementation((key: string) => key) },
        },
        Account,
        {
          provide: UserService,
          useValue: {
            findById: vi.fn(),
            update: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: LinkedIdentities,
          useValue: identitiesMock,
        },
        {
          provide: AccountIdentity,
          useValue: {
            verifyPassword: vi.fn().mockReturnValue(okAsync(undefined)),
            hasPassword: vi.fn().mockReturnValue(okAsync(true)),
          },
        },
      ],
    }).compile();

    service = module.get(Account);
    userService = module.get(UserService);
    identities = module.get(LinkedIdentities) as unknown as MockedIdentities;
    identity = module.get(AccountIdentity);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAccount', () => {
    it('should return the account DTO for an active user', async () => {
      (userService.findById as vi.Mock).mockResolvedValue(baseUser);
      identities.listForUser.mockResolvedValue([baseIdentity]);

      const result = await inspectResult(service.get(baseUser.id));

      expect(userService.findById).toHaveBeenCalledWith(baseUser.id);
      expect(identities.listForUser).toHaveBeenCalledWith(baseUser.id);
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

      const result = await inspectResult(service.get('missing-user'));

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('should set hasPassword to false when there is no credential account', async () => {
      (identity.hasPassword as vi.Mock).mockReturnValueOnce(okAsync(false));
      (userService.findById as vi.Mock).mockResolvedValue(baseUser);
      identities.listForUser.mockResolvedValue([baseIdentity]);

      const result = await inspectResult(service.get(baseUser.id));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.hasPassword).toBe(false);
    });

    it('maps unexpected user-service failures to DEPENDENCY_UNAVAILABLE', async () => {
      const error = new Error('database unavailable');
      (userService.findById as vi.Mock).mockRejectedValue(error);

      const result = await inspectResult(service.get('db-failure'));

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
      identities.listForUser.mockResolvedValue([
        { ...baseIdentity, providerEmailVerifiedAt: null },
      ]);

      const result = await inspectResult(service.get(baseUser.id));

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
      identities.listForUser
        .mockResolvedValueOnce([baseIdentity])
        .mockResolvedValueOnce([baseIdentity]);
      (userService.update as vi.Mock).mockReturnValue(okAsync(undefined));

      const dto: UpdateAccountDto = {
        nickname: 'NewNick',
        avatar: 'https://example.com/new-avatar.png',
      };

      const result = await inspectResult(service.update(baseUser.id, dto));

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
      identities.listForUser
        .mockResolvedValueOnce([baseIdentity])
        .mockResolvedValueOnce([baseIdentity]);
      (userService.update as vi.Mock).mockReturnValue(okAsync(undefined));

      const dto: UpdateAccountDto = { nickname: '', avatar: '' };

      const result = await inspectResult(service.update(baseUser.id, dto));

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
      identities.listForUser
        .mockResolvedValueOnce([baseIdentity])
        .mockResolvedValueOnce([baseIdentity]);
      (userService.update as vi.Mock).mockReturnValue(okAsync(undefined));

      const dto: UpdateAccountDto = {};

      const result = await inspectResult(service.update(baseUser.id, dto));

      expect(userService.update).toHaveBeenCalledWith(baseUser.id, {});
      expect(result.ok).toBe(true);
    });

    it('should return a not-found DomainFailure when user does not exist', async () => {
      (userService.findById as vi.Mock).mockResolvedValue(null);

      const result = await inspectResult(
        service.update('missing-user', { nickname: 'X' }),
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
      // 2 calls to listForUser: initial read, then post-unlink reload
      // (the transaction re-check lives inside the port implementation).
      identities.listForUser
        .mockResolvedValueOnce([baseIdentity, secondIdentity])
        .mockResolvedValueOnce([secondIdentity]);

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'Passw0rd123',
        }),
      );

      expect(identity.verifyPassword).toHaveBeenCalledWith(
        baseUser.id,
        'Passw0rd123',
      );
      expect(identities.unlinkInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: baseUser.id,
          identityId: baseIdentity.id,
        }),
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
      identities.listForUser.mockResolvedValueOnce([
        baseIdentity,
        secondIdentity,
      ]);
      identity.verifyPassword.mockReturnValue(
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
      expect(identities.unlinkInTransaction).not.toHaveBeenCalled();
    });

    it('should return AUTH_PASSWORD_NOT_SET for OAuth-only users', async () => {
      (userService.findById as vi.Mock).mockResolvedValueOnce(baseUser);
      identities.listForUser.mockResolvedValueOnce([
        baseIdentity,
        secondIdentity,
      ]);
      identity.verifyPassword.mockReturnValue(
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
      expect(identities.unlinkInTransaction).not.toHaveBeenCalled();
    });

    it('should return an authorization DomainFailure when unlinking the last sign-in method', async () => {
      (identity.hasPassword as vi.Mock).mockReturnValueOnce(okAsync(false));
      (userService.findById as vi.Mock).mockResolvedValueOnce(baseUser);
      identities.listForUser.mockResolvedValueOnce([baseIdentity]);

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
      identities.listForUser
        .mockResolvedValueOnce([baseIdentity])
        .mockResolvedValueOnce([]);

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
      identities.listForUser.mockResolvedValueOnce([baseIdentity]);

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
      (identity.hasPassword as vi.Mock).mockReturnValueOnce(okAsync(false));
      (userService.findById as vi.Mock)
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce(baseUser);
      // 3 calls: getActiveAccountUser, tx re-check, getAccount
      identities.listForUser
        .mockResolvedValueOnce([baseIdentity, secondIdentity])
        .mockResolvedValueOnce([secondIdentity]);

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'Passw0rd123',
        }),
      );

      expect(identities.unlinkInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: baseUser.id,
          identityId: baseIdentity.id,
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.linkedIdentities).toHaveLength(1);
    });

    it('should return not-found when deleteMany removes no rows', async () => {
      (userService.findById as vi.Mock).mockResolvedValueOnce(baseUser);
      // initial read then post-unlink reload
      identities.listForUser
        .mockResolvedValueOnce([baseIdentity, secondIdentity])
        .mockResolvedValueOnce([baseIdentity, secondIdentity]);
      identities.unlinkInTransaction.mockRejectedValue(
        new IdentityUnlinkRejected('not-found'),
      );

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
      (identity.hasPassword as vi.Mock)
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
      identities.listForUser.mockResolvedValueOnce([
        baseIdentity,
        secondIdentity,
      ]);
      // 事务内的 hasPassword 返回 Err → 端口实现抛出 → 用例映射成依赖故障。
      identities.unlinkInTransaction.mockImplementationOnce(
        async (input: { hasPassword: (scope: object) => Promise<boolean> }) => {
          await input.hasPassword({});
        },
      );

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'Passw0rd123',
        }),
      );

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'dependency', code: 'DEPENDENCY_UNAVAILABLE' },
      });
      // 事务内的 Err 必须让事务回滚 —— 表现为「没有回读档案」。
      // （端口合并了事务边界后 `deleteMany` 不再是可见调用点；这条断言
      // 守的是同一个事实：失败路径不产生副作用。）
      expect(userService.findById).toHaveBeenCalledTimes(1);
    });
  });
});
