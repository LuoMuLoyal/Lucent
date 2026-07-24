import type { DeepMocked } from '../../../common/types/deep-mocked';
import { nonDeleted } from '../../../common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { UserStatus } from '#generated/prisma/client';

import { AccountService } from './account.service';
import { UserService } from '../../user';
import { ResultCode } from '../../../common';
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

describe('AccountService', () => {
  let service: AccountService;
  let userService: DeepMocked<UserService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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
            update: vi.fn(),
            unlinkIdentity: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AccountService);
    userService = module.get(UserService);
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

      const result = await service.getAccount(baseUser.id);

      expect(userService.findByIdWithIdentities).toHaveBeenCalledWith(
        baseUser.id,
      );
      expect(result).toEqual({
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

    it('should throw NotFoundException when the user does not exist', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValue(null);

      await expect(service.getAccount('missing-user')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getAccount('missing-user')).rejects.toMatchObject({
        response: {
          code: ResultCode.NOT_FOUND,
          message: 'account.user_not_found',
        },
      });
    });

    it('should set hasPassword to false when passwordHash is null', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValue({
        ...baseUser,
        passwordHash: null,
        identities: [baseIdentity],
      });

      const result = await service.getAccount(baseUser.id);

      expect(result.hasPassword).toBe(false);
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

      const result = await service.getAccount(baseUser.id);

      expect(result.emailVerifiedAt).toBeNull();
      expect(result.lastLoginAt).toBeNull();
      expect(result.avatar).toBeNull();
      expect(result.nickname).toBeNull();
      const firstIdentity = result.linkedIdentities[0];
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
      (userService.update as vi.Mock).mockResolvedValue(undefined);

      const dto: UpdateAccountDto = {
        nickname: 'NewNick',
        avatar: 'https://example.com/new-avatar.png',
      };

      const result = await service.updateAccount(baseUser.id, dto);

      expect(userService.update).toHaveBeenCalledWith(baseUser.id, {
        nickname: 'NewNick',
        avatar: 'https://example.com/new-avatar.png',
      });
      expect(result.nickname).toBe('NewNick');
      expect(result.avatar).toBe('https://example.com/new-avatar.png');
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
      (userService.update as vi.Mock).mockResolvedValue(undefined);

      const dto: UpdateAccountDto = { nickname: '', avatar: '' };

      const result = await service.updateAccount(baseUser.id, dto);

      expect(userService.update).toHaveBeenCalledWith(baseUser.id, {
        nickname: null,
        avatar: null,
      });
      expect(result.nickname).toBeNull();
      expect(result.avatar).toBeNull();
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
      (userService.update as vi.Mock).mockResolvedValue(undefined);

      const dto: UpdateAccountDto = {};

      await service.updateAccount(baseUser.id, dto);

      expect(userService.update).toHaveBeenCalledWith(baseUser.id, {});
    });

    it('should throw NotFoundException when user does not exist', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValue(null);

      await expect(
        service.updateAccount('missing-user', { nickname: 'X' }),
      ).rejects.toThrow(NotFoundException);
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
      (userService.unlinkIdentity as vi.Mock).mockResolvedValue(undefined);

      const result = await service.unlinkIdentity(baseUser.id, baseIdentity.id);

      expect(userService.unlinkIdentity).toHaveBeenCalledWith(baseIdentity.id);
      expect(result.linkedIdentities).toHaveLength(1);
      const firstIdentity = result.linkedIdentities[0];
      if (!firstIdentity) throw new Error('no identity');
      expect(firstIdentity.id).toBe(secondIdentity.id);
    });

    it('should throw ForbiddenException when unlinking the last sign-in method', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValueOnce({
        ...baseUser,
        passwordHash: null,
        identities: [baseIdentity],
      });

      await expect(
        service.unlinkIdentity(baseUser.id, baseIdentity.id),
      ).rejects.toMatchObject({
        response: {
          code: ResultCode.FORBIDDEN,
          message: 'account.cannot_unlink_last_method',
        },
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
      (userService.unlinkIdentity as vi.Mock).mockResolvedValue(undefined);

      const result = await service.unlinkIdentity(baseUser.id, baseIdentity.id);

      expect(result.linkedIdentities).toHaveLength(0);
    });

    it('should throw NotFoundException when identity does not exist', async () => {
      (userService.findByIdWithIdentities as vi.Mock).mockResolvedValueOnce({
        ...baseUser,
        identities: [baseIdentity],
      });

      await expect(
        service.unlinkIdentity(baseUser.id, 'nonexistent-identity'),
      ).rejects.toMatchObject({
        response: {
          code: ResultCode.NOT_FOUND,
          message: 'account.identity_not_found',
        },
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
      (userService.unlinkIdentity as vi.Mock).mockResolvedValue(undefined);

      const result = await service.unlinkIdentity(baseUser.id, baseIdentity.id);

      expect(userService.unlinkIdentity).toHaveBeenCalledWith(baseIdentity.id);
      expect(result.linkedIdentities).toHaveLength(1);
    });
  });
});
