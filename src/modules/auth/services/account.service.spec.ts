import {
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { I18nService } from 'nestjs-i18n';
import type { UserService } from '../../user/services/user.service';
import type { VerificationCodeService } from './verification-code.service';
import type { AuthAccountRepositoryPort } from '../repositories/account.repository';
import { AuthAccountService } from './account.service';

import * as argon2Module from 'argon2';

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(),
  verify: vi.fn(),
  Options: {},
}));

const argon2 = argon2Module as unknown as { verify: vi.Mock };

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  passwordHash: '$argon2id$mock',
  nickname: 'TestUser',
  deletedAt: null,
};

describe('AuthAccountService', () => {
  let service: AuthAccountService;
  let accountRepo: vi.Mocked<AuthAccountRepositoryPort>;
  let userService: vi.Mocked<UserService>;
  let verificationCodeService: vi.Mocked<VerificationCodeService>;
  let i18n: vi.Mocked<I18nService>;

  beforeEach(() => {
    accountRepo = {
      softDeleteUser: vi.fn().mockResolvedValue(undefined),
    };
    userService = {
      findById: vi.fn(),
    } as unknown as vi.Mocked<UserService>;
    verificationCodeService = {
      verify: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<VerificationCodeService>;
    i18n = {
      t: vi.fn().mockReturnValue('translated message'),
    } as unknown as vi.Mocked<I18nService>;

    service = new AuthAccountService(
      accountRepo,
      userService,
      verificationCodeService,
      i18n,
    );
  });

  describe('getActiveUser', () => {
    it('returns user when found', async () => {
      userService.findById.mockResolvedValue(mockUser as never);

      const result = await service.getActiveUser('user-1');

      expect(result).toBe(mockUser);
    });

    it('throws NotFoundException when user not found', async () => {
      userService.findById.mockResolvedValue(null);

      await expect(service.getActiveUser('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteAccount', () => {
    it('deletes with password when password is valid', async () => {
      userService.findById.mockResolvedValue(mockUser as never);
      argon2.verify.mockResolvedValue(true);

      await service.deleteAccount('user-1', { password: 'correct-pass' });

      expect(argon2.verify).toHaveBeenCalledWith(
        mockUser.passwordHash,
        'correct-pass',
      );
      expect(accountRepo.softDeleteUser).toHaveBeenCalledWith(
        'user-1',
        expect.any(Date),
      );
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      userService.findById.mockResolvedValue(mockUser as never);
      argon2.verify.mockResolvedValue(false);

      await expect(
        service.deleteAccount('user-1', { password: 'wrong-pass' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(accountRepo.softDeleteUser).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when OAuth account has no passwordHash', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        passwordHash: null,
      } as never);

      await expect(
        service.deleteAccount('user-1', { password: 'any' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('deletes with verification code when code is valid', async () => {
      userService.findById.mockResolvedValue(mockUser as never);

      await service.deleteAccount('user-1', { code: '123456' });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'delete-account',
      );
      expect(accountRepo.softDeleteUser).toHaveBeenCalled();
    });

    it('throws BadRequestException when code provided but user has no email', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        email: null,
      } as never);

      await expect(
        service.deleteAccount('user-1', { code: '123456' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when neither password nor code provided', async () => {
      userService.findById.mockResolvedValue(mockUser as never);

      await expect(service.deleteAccount('user-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
