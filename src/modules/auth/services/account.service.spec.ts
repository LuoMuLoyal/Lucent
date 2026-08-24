import {
  createDomainFailure,
  errAsync,
  okAsync,
  type ResultAsync,
} from '../../../common/result';
import type { UserService } from '../../user';
import type { VerificationCodeService } from './identity/verification-code.service';
import type { PasswordReauthService } from './identity/password-reauth.service';
import type { AuthAccountRepositoryPort } from '../repositories/account.repository';
import { AuthAccountService } from './account.service';

/**
 * Folds a ResultAsync into a plain outcome so specs can assert both success
 * values and DomainFailure codes without throwing.
 */
function collectResult<T, E>(
  result: ResultAsync<T, E>,
): Promise<{ ok: true; value: T } | { ok: false; error: E }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  nickname: 'TestUser',
  deletedAt: null,
};

describe('AuthAccountService', () => {
  let service: AuthAccountService;
  let accountRepo: vi.Mocked<AuthAccountRepositoryPort>;
  let userService: vi.Mocked<UserService>;
  let passwordReauthService: vi.Mocked<PasswordReauthService>;
  let verificationCodeService: vi.Mocked<VerificationCodeService>;

  beforeEach(() => {
    accountRepo = {
      softDeleteUser: vi.fn().mockReturnValue(okAsync(undefined)),
    };
    userService = {
      findById: vi.fn(),
    } as unknown as vi.Mocked<UserService>;
    passwordReauthService = {
      verify: vi.fn().mockReturnValue(okAsync(undefined)),
    } as unknown as vi.Mocked<PasswordReauthService>;
    verificationCodeService = {
      verify: vi.fn().mockReturnValue(okAsync(undefined)),
    } as unknown as vi.Mocked<VerificationCodeService>;

    service = new AuthAccountService(
      accountRepo,
      userService,
      passwordReauthService,
      verificationCodeService,
    );
  });

  describe('getActiveUser', () => {
    it('returns user when found', async () => {
      userService.findById.mockResolvedValue(mockUser as never);

      const outcome = await collectResult(service.getActiveUser('user-1'));

      expect(outcome).toEqual({ ok: true, value: mockUser });
    });

    it('returns RESOURCE_NOT_FOUND when user not found', async () => {
      userService.findById.mockResolvedValue(null);

      const outcome = await collectResult(service.getActiveUser('nonexistent'));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
      });
    });

    it('does not mask infrastructure failures', async () => {
      userService.findById.mockRejectedValue(new Error('db connection lost'));

      await expect(
        collectResult(service.getActiveUser('user-1')),
      ).rejects.toThrow('db connection lost');
    });
  });

  describe('deleteAccount', () => {
    it('deletes with password when password is valid', async () => {
      userService.findById.mockResolvedValue(mockUser as never);

      const outcome = await collectResult(
        service.deleteAccount('user-1', { password: 'correct-pass' }),
      );

      expect(passwordReauthService.verify).toHaveBeenCalledWith(
        'user-1',
        'correct-pass',
      );
      expect(accountRepo.softDeleteUser).toHaveBeenCalledWith(
        'user-1',
        expect.any(Date),
      );
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('returns AUTH_WRONG_PASSWORD when password is wrong', async () => {
      userService.findById.mockResolvedValue(mockUser as never);
      passwordReauthService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_WRONG_PASSWORD',
          }),
        ),
      );

      const outcome = await collectResult(
        service.deleteAccount('user-1', { password: 'wrong-pass' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_WRONG_PASSWORD' }),
      });
      expect(accountRepo.softDeleteUser).not.toHaveBeenCalled();
    });

    it('returns AUTH_PASSWORD_NOT_SET when OAuth account has no credential password', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
      } as never);
      passwordReauthService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_PASSWORD_NOT_SET',
          }),
        ),
      );

      const outcome = await collectResult(
        service.deleteAccount('user-1', { password: 'any' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_PASSWORD_NOT_SET' }),
      });
      expect(accountRepo.softDeleteUser).not.toHaveBeenCalled();
    });

    it('propagates a password-reauth rate-limit failure', async () => {
      userService.findById.mockResolvedValue(mockUser as never);
      passwordReauthService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'RATE_LIMITED',
            retryAfter: 300,
          }),
        ),
      );

      const outcome = await collectResult(
        service.deleteAccount('user-1', { password: 'any' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RATE_LIMITED' }),
      });
      expect(accountRepo.softDeleteUser).not.toHaveBeenCalled();
    });

    it('deletes with verification code when code is valid', async () => {
      userService.findById.mockResolvedValue(mockUser as never);

      const outcome = await collectResult(
        service.deleteAccount('user-1', { code: '123456' }),
      );

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'delete-account',
      );
      expect(accountRepo.softDeleteUser).toHaveBeenCalled();
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('propagates verification-code DomainFailures without soft-deleting', async () => {
      userService.findById.mockResolvedValue(mockUser as never);
      verificationCodeService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_VERIFICATION_CODE_EXPIRED',
          }),
        ),
      );

      const outcome = await collectResult(
        service.deleteAccount('user-1', { code: '123456' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_VERIFICATION_CODE_EXPIRED',
        }),
      });
      expect(accountRepo.softDeleteUser).not.toHaveBeenCalled();
    });

    it('returns VALIDATION_FAILED when code provided but user has no email', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        email: null,
      } as never);

      const outcome = await collectResult(
        service.deleteAccount('user-1', { code: '123456' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      });
      expect(accountRepo.softDeleteUser).not.toHaveBeenCalled();
    });

    it('returns VALIDATION_FAILED when neither password nor code provided', async () => {
      userService.findById.mockResolvedValue(mockUser as never);

      const outcome = await collectResult(service.deleteAccount('user-1', {}));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      });
      expect(accountRepo.softDeleteUser).not.toHaveBeenCalled();
    });

    it('does not mask infrastructure failures', async () => {
      userService.findById.mockRejectedValue(new Error('db connection lost'));

      await expect(
        collectResult(service.deleteAccount('user-1', { password: 'any' })),
      ).rejects.toThrow('db connection lost');
      expect(accountRepo.softDeleteUser).not.toHaveBeenCalled();
    });
  });
});
