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

jest.mock('argon2', () => ({
  argon2id: 2,
  hash: jest.fn(),
  verify: jest.fn(),
  Options: {},
}));

// Import argon2 after the mock so the mock is in effect
const argon2 = jest.requireMock('argon2') as {
  verify: jest.Mock;
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  passwordHash: '$argon2id$mock',
  nickname: 'TestUser',
  deletedAt: null,
};

describe('AuthAccountService', () => {
  let service: AuthAccountService;
  let accountRepo: jest.Mocked<AuthAccountRepositoryPort>;
  let userService: jest.Mocked<UserService>;
  let verificationCodeService: jest.Mocked<VerificationCodeService>;
  let i18n: jest.Mocked<I18nService>;

  beforeEach(() => {
    accountRepo = {
      softDeleteUser: jest.fn().mockResolvedValue(undefined),
    };
    userService = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<UserService>;
    verificationCodeService = {
      verify: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VerificationCodeService>;
    i18n = {
      t: jest.fn().mockReturnValue('translated message'),
    } as unknown as jest.Mocked<I18nService>;

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
