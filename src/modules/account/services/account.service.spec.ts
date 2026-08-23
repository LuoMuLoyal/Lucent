import type { DeepMocked } from '../../../common/types/deep-mocked';
import { nonDeleted } from '../../../common';
import { createDomainFailure, errAsync, okAsync } from '../../../common/result';
import type { DomainFailure, ResultAsync } from '../../../common/result';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { I18nService } from 'nestjs-i18n';
import { UserStatus } from '#generated/prisma/client';

import { AccountService } from './account.service';
import { PasswordReauthService } from '../../auth';
import { UserService } from '../../user';
import type { UpdateAccountDto } from '../dto/update.dto';

const baseUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  passwordHash: '$argon2id$mock',
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
  provider: 'wechat_web',
  providerUserId: 'wx-openid-xxx',
  email: 'wechat-bound@example.com',
  emailVerifiedAt: new Date('2026-01-15T10:30:00.000Z'),
  rawProfile: { sub: 'wx-openid-xxx' },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const secondIdentity = {
  id: 'identity-uuid-2',
  userId: baseUser.id,
  provider: 'google',
  providerUserId: 'google-sub-yyy',
  email: 'google-bound@example.com',
  emailVerifiedAt: null,
  rawProfile: { sub: 'google-sub-yyy' },
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

describe('AccountService', () => {
  let service: AccountService;
  let userService: DeepMocked<UserService>;
  let passwordReauthService: vi.Mocked<PasswordReauthService>;
  let module: TestingModule;

  beforeEach(async () => {
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
            findByIdWithIdentities: vi.fn(),
            update: vi.fn().mockReturnValue(okAsync(undefined)),
            unlinkIdentity: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: PasswordReauthService,
          useValue: {
            verify: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
      ],
    }).compile();

    service = module.get(AccountService);
    userService = module.get(UserService);
    passwordReauthService = module.get(PasswordReauthService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAccount', () => {
    it('should return the account DTO for an active user', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValue({
        ...baseUser,
        identities: [baseIdentity],
      });

      const result = await inspectResult(service.getAccount(baseUser.id));

      expect(userService.findByIdWithIdentities).toHaveBeenCalledWith(
        baseUser.id,
      );
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
            provider: baseIdentity.provider,
            email: baseIdentity.email,
            emailVerifiedAt: '2026-01-15T10:30:00.000Z',
            linkedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-06-10T12:00:00.000Z',
      });
    });

    it('should return a not-found DomainFailure when the user does not exist', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValue(null);

      const result = await inspectResult(service.getAccount('missing-user'));

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'not_found', code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it('should set hasPassword to false when passwordHash is null', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValue({
        ...baseUser,
        passwordHash: null,
        identities: [baseIdentity],
      });

      const result = await inspectResult(service.getAccount(baseUser.id));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.hasPassword).toBe(false);
    });

    it('rethrows unexpected user-service failures', async () => {
      const error = new Error('database unavailable');
      (userService.findByIdWithIdentities as vi.Mock).mockRejectedValue(error);

      await expect(
        service.getAccount('db-failure').match(
          (value) => value,
          (failure) => failure,
        ),
      ).rejects.toBe(error);
    });

    it('should return null fields when dates are null', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValue({
        ...baseUser,
        emailVerifiedAt: null,
        lastLoginAt: null,
        avatar: null,
        nickname: null,
        identities: [{ ...baseIdentity, emailVerifiedAt: null }],
      });

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
      (userService.findByIdWithIdentities as vi.Mock)
        .mockResolvedValueOnce({
          ...baseUser,
          identities: [baseIdentity],
        })
        .mockResolvedValueOnce({
          ...baseUser,
          nickname: 'NewNick',
          avatar: 'https://example.com/new-avatar.png',
          identities: [baseIdentity],
        });
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
      (userService.findByIdWithIdentities as vi.Mock)
        .mockResolvedValueOnce({
          ...baseUser,
          identities: [baseIdentity],
        })
        .mockResolvedValueOnce({
          ...baseUser,
          nickname: null,
          avatar: null,
          identities: [baseIdentity],
        });
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
      (userService.findByIdWithIdentities as vi.Mock)
        .mockResolvedValueOnce({
          ...baseUser,
          identities: [baseIdentity],
        })
        .mockResolvedValueOnce({
          ...baseUser,
          identities: [baseIdentity],
        });
      (userService.update as vi.Mock).mockReturnValue(okAsync(undefined));

      const dto: UpdateAccountDto = {};

      const result = await inspectResult(
        service.updateAccount(baseUser.id, dto),
      );

      expect(userService.update).toHaveBeenCalledWith(baseUser.id, {});
      expect(result.ok).toBe(true);
    });

    it('should return a not-found DomainFailure when user does not exist', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValue(null);

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
      (userService.findByIdWithIdentities as vi.Mock)
        .mockResolvedValueOnce({
          ...baseUser,
          passwordHash: '$argon2id$exists',
          identities: [baseIdentity, secondIdentity],
        })
        .mockResolvedValueOnce({
          ...baseUser,
          passwordHash: '$argon2id$exists',
          identities: [secondIdentity],
        });
      (userService.unlinkIdentity as vi.Mock).mockReturnValue(
        okAsync(undefined),
      );

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'Passw0rd123',
        }),
      );

      expect(passwordReauthService.verify).toHaveBeenCalledWith(
        baseUser.id,
        'Passw0rd123',
      );
      expect(userService.unlinkIdentity).toHaveBeenCalledWith(baseIdentity.id);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.linkedIdentities).toHaveLength(1);
      const firstIdentity = result.value.linkedIdentities[0];
      if (!firstIdentity) throw new Error('no identity');
      expect(firstIdentity.id).toBe(secondIdentity.id);
    });

    it('should return AUTH_WRONG_PASSWORD when password verification fails', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValueOnce({
        ...baseUser,
        passwordHash: '$argon2id$exists',
        identities: [baseIdentity, secondIdentity],
      });
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
      expect(userService.unlinkIdentity).not.toHaveBeenCalled();
    });

    it('should return AUTH_PASSWORD_NOT_SET for OAuth-only users', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValueOnce({
        ...baseUser,
        passwordHash: null,
        identities: [baseIdentity, secondIdentity],
      });
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
      expect(userService.unlinkIdentity).not.toHaveBeenCalled();
    });

    it('should return an authorization DomainFailure when unlinking the last sign-in method', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValueOnce({
        ...baseUser,
        passwordHash: null,
        identities: [baseIdentity],
      });

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
      (userService.findByIdWithIdentities as vi.Mock)
        .mockResolvedValueOnce({
          ...baseUser,
          passwordHash: '$argon2id$exists',
          identities: [baseIdentity],
        })
        .mockResolvedValueOnce({
          ...baseUser,
          passwordHash: '$argon2id$exists',
          identities: [],
        });
      (userService.unlinkIdentity as vi.Mock).mockReturnValue(
        okAsync(undefined),
      );

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
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValueOnce({
        ...baseUser,
        identities: [baseIdentity],
      });

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

    it('should allow unlinking when user has multiple identities and no password', async () => {
      (userService.findByIdWithIdentities as vi.Mock)
        .mockResolvedValueOnce({
          ...baseUser,
          passwordHash: null,
          identities: [baseIdentity, secondIdentity],
        })
        .mockResolvedValueOnce({
          ...baseUser,
          passwordHash: null,
          identities: [secondIdentity],
        });
      (userService.unlinkIdentity as vi.Mock).mockReturnValue(
        okAsync(undefined),
      );

      const result = await inspectResult(
        service.unlinkIdentity(baseUser.id, baseIdentity.id, {
          password: 'Passw0rd123',
        }),
      );

      expect(userService.unlinkIdentity).toHaveBeenCalledWith(baseIdentity.id);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected account success');
      expect(result.value.linkedIdentities).toHaveLength(1);
    });
  });
});
