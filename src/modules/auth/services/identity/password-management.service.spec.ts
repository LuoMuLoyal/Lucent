import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { I18nService } from 'nestjs-i18n';

import { PasswordManagementService } from './password-management.service.js';
import { UserService } from '../../../user/index.js';
import { VerificationCodeService } from './verification-code.service.js';
import { AuthTokenService } from '../token.service.js';
import { PasswordReauthService } from './password-reauth.service.js';
import { INotificationSender } from '../../../notifications/index.js';
import { AuthBetterAuthAdapter } from '../../adapters/better-auth.adapter.js';
import { PrismaService } from '../../../../prisma/index.js';
import type { NotificationListItemDto } from '../../../notifications/index.js';
import type { User } from '#generated/prisma/client.js';
import { UserStatus } from '#generated/prisma/client.js';
import {
  createDomainFailure,
  errAsync,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';

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

function createBetterAuthAPIError(
  code: string,
  statusCode = 400,
): { statusCode: number; body: { code: string; message: string } } {
  return { statusCode, body: { code, message: `Better Auth: ${code}` } };
}

// ── Fixtures ──────────────────────────────────────────────────

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  emailVerified: true,
  nickname: 'Tester',
  avatar: null,
  status: UserStatus.active,
  emailVerifiedAt: new Date('2026-01-01'),
  lastLoginAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-06-01'),
};

const mockNotification: NotificationListItemDto = {
  id: 'notif-1',
  type: 'system_announcement',
  title: 'Test',
  content: 'Test content',
  isRead: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  action: null,
  actionPayload: null,
};

const wrongPasswordFailure: DomainFailure = createDomainFailure({
  kind: 'authentication',
  code: 'AUTH_WRONG_PASSWORD',
});

const mockCredentialAccount = {
  id: 'account-1',
  userId: 'user-1',
  providerId: 'credential',
  issuer: 'local:credential',
  accountId: 'user-1',
  password: '$argon2id$hashed',
};

// ── Suite ─────────────────────────────────────────────────────

describe('PasswordManagementService', () => {
  let service: PasswordManagementService;
  let userService: vi.Mocked<UserService>;
  let verificationCodeService: vi.Mocked<VerificationCodeService>;
  let authTokenService: vi.Mocked<AuthTokenService>;
  let passwordReauthService: vi.Mocked<PasswordReauthService>;
  let notificationsService: vi.Mocked<INotificationSender>;
  let betterAuthAdapter: vi.Mocked<AuthBetterAuthAdapter>;
  let prisma: vi.Mocked<PrismaService>;

  let verifyEmailMock: vi.Mock;
  let accountFindFirstMock: vi.Mock;
  let accountUpdateMock: vi.Mock;
  let accountCreateMock: vi.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordManagementService,
        {
          provide: UserService,
          useValue: {
            findByEmail: vi.fn(),
            findById: vi.fn(),
            update: vi.fn().mockReturnValue(okAsync(mockUser)),
          },
        },
        {
          provide: VerificationCodeService,
          useValue: {
            verify: vi.fn().mockReturnValue(okAsync(undefined)),
            send: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: AuthTokenService,
          useValue: {
            revokeAll: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: PasswordReauthService,
          useValue: {
            verify: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: INotificationSender,
          useValue: {
            create: vi.fn().mockReturnValue(okAsync(mockNotification)),
          },
        },
        {
          provide: AuthBetterAuthAdapter,
          useValue: {
            auth: {
              api: {
                verifyEmail: vi.fn(),
              },
            },
            hashPassword: vi.fn().mockResolvedValue('$argon2id$new-hash'),
            credentialProviderId: 'credential',
            credentialIssuer: 'local:credential',
          },
        },
        {
          provide: PrismaService,
          useValue: {
            account: {
              findFirst: vi.fn(),
              update: vi.fn(),
              create: vi.fn(),
            },
          },
        },
        {
          provide: I18nService,
          useValue: {
            t: vi.fn((key: string) => key),
          },
        },
      ],
    }).compile();

    service = module.get(PasswordManagementService);
    userService = module.get(UserService);
    verificationCodeService = module.get(VerificationCodeService);
    authTokenService = module.get(AuthTokenService);
    passwordReauthService = module.get(PasswordReauthService);
    notificationsService = module.get(INotificationSender);
    betterAuthAdapter = module.get(AuthBetterAuthAdapter);
    prisma = module.get(PrismaService);

    // Default mock responses
    userService.findByEmail.mockResolvedValue(null);
    userService.findById.mockResolvedValue(mockUser);
    userService.update.mockReturnValue(okAsync(mockUser));
    authTokenService.revokeAll.mockReturnValue(okAsync(undefined));
    verificationCodeService.verify.mockReturnValue(okAsync(undefined));
    verificationCodeService.send.mockReturnValue(okAsync(undefined));
    notificationsService.create.mockReturnValue(okAsync(mockNotification));

    verifyEmailMock = betterAuthAdapter.auth.api
      .verifyEmail as unknown as vi.Mock;
    accountFindFirstMock = prisma.account.findFirst as unknown as vi.Mock;
    accountUpdateMock = prisma.account.update as unknown as vi.Mock;
    accountCreateMock = prisma.account.create as unknown as vi.Mock;

    verifyEmailMock.mockResolvedValue({
      status: true,
    });
    accountFindFirstMock.mockResolvedValue(mockCredentialAccount);
    accountUpdateMock.mockResolvedValue(mockCredentialAccount);
    accountCreateMock.mockResolvedValue(mockCredentialAccount);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════
  // changePassword
  // ════════════════════════════════════════════════════════════

  describe('changePassword', () => {
    it('should change password and revoke all sessions', async () => {
      const outcome = await collectResult(
        service.changePassword('user-1', {
          password: 'OldPass1',
          newPassword: 'NewPass1',
        }),
      );

      expect(passwordReauthService.verify).toHaveBeenCalledWith(
        'user-1',
        'OldPass1',
      );
      expect(accountFindFirstMock).toHaveBeenCalledWith({
        where: { userId: 'user-1', providerId: 'credential' },
      });
      expect(betterAuthAdapter.hashPassword).toHaveBeenCalledWith('NewPass1');
      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: { password: '$argon2id$new-hash' },
      });
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-1');
      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'password_changed' }),
      );
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should reject wrong password with AUTH_WRONG_PASSWORD', async () => {
      passwordReauthService.verify.mockReturnValue(
        errAsync(wrongPasswordFailure),
      );

      const outcome = await collectResult(
        service.changePassword('user-1', {
          password: 'WrongOld',
          newPassword: 'NewPass1',
        }),
      );

      expect(outcome).toEqual({ ok: false, error: wrongPasswordFailure });
      expect(accountFindFirstMock).not.toHaveBeenCalled();
      expect(authTokenService.revokeAll).not.toHaveBeenCalled();
    });

    it('should propagate a password-reauth failure instead of changing password', async () => {
      passwordReauthService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'RATE_LIMITED',
          }),
        ),
      );

      const outcome = await collectResult(
        service.changePassword('user-1', {
          password: 'OldPass1',
          newPassword: 'NewPass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RATE_LIMITED' }),
      });
      expect(authTokenService.revokeAll).not.toHaveBeenCalled();
    });

    it('should reject OAuth-only user without credential account', async () => {
      passwordReauthService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_PASSWORD_NOT_SET',
          }),
        ),
      );

      const outcome = await collectResult(
        service.changePassword('user-1', {
          password: 'Old',
          newPassword: 'New',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_PASSWORD_NOT_SET' }),
      });
    });

    it('should reject a missing user with RESOURCE_NOT_FOUND', async () => {
      userService.findById.mockResolvedValue(null);

      const outcome = await collectResult(
        service.changePassword('user-1', {
          password: 'Old',
          newPassword: 'New',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
      });
    });

    it('should still succeed when the password-changed notification fails (best-effort)', async () => {
      notificationsService.create.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'internal',
            code: 'INTERNAL_ERROR',
          }),
        ),
      );

      const outcome = await collectResult(
        service.changePassword('user-1', {
          password: 'OldPass1',
          newPassword: 'NewPass1',
        }),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should still succeed when the notification write rejects (best-effort)', async () => {
      notificationsService.create.mockRejectedValue(
        new Error('notification down'),
      );

      const outcome = await collectResult(
        service.changePassword('user-1', {
          password: 'OldPass1',
          newPassword: 'NewPass1',
        }),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
    });
  });

  // ════════════════════════════════════════════════════════════
  // setPassword
  // ════════════════════════════════════════════════════════════

  describe('setPassword', () => {
    beforeEach(() => {
      accountFindFirstMock.mockResolvedValue(null);
    });

    it('should set password for OAuth user and revoke sessions', async () => {
      const outcome = await collectResult(
        service.setPassword('user-1', {
          code: '123456',
          password: 'NewPass1',
        }),
      );

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'set-password',
      );
      expect(betterAuthAdapter.hashPassword).toHaveBeenCalledWith('NewPass1');
      expect(accountCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            providerId: 'credential',
            issuer: 'local:credential',
            accountId: 'user-1',
            password: '$argon2id$new-hash',
          }),
        }),
      );
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-1');
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should reject when user already has a password', async () => {
      accountFindFirstMock.mockResolvedValue(mockCredentialAccount);

      const outcome = await collectResult(
        service.setPassword('user-1', {
          code: '123456',
          password: 'NewPass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });

    it('should reject when user has no email', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        email: '',
      } as unknown as User);

      const outcome = await collectResult(
        service.setPassword('user-1', {
          code: '123456',
          password: 'NewPass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      });
    });
  });

  // ════════════════════════════════════════════════════════════
  // changeEmail
  // ════════════════════════════════════════════════════════════

  describe('changeEmail', () => {
    it('should change email after password and code verification', async () => {
      const outcome = await collectResult(
        service.changeEmail('user-1', {
          newEmail: 'changed@example.com',
          code: '123456',
          password: 'Passw0rd123',
        }),
      );

      expect(passwordReauthService.verify).toHaveBeenCalledWith(
        'user-1',
        'Passw0rd123',
      );
      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'changed@example.com',
        '123456',
        'change-email',
      );
      expect(userService.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          email: 'changed@example.com',
          emailVerifiedAt: expect.any(Date),
        }),
      );
      expect(outcome).toEqual({ ok: true, value: mockUser });
    });

    it('should reject when password verification fails', async () => {
      passwordReauthService.verify.mockReturnValue(
        errAsync(wrongPasswordFailure),
      );

      const outcome = await collectResult(
        service.changeEmail('user-1', {
          newEmail: 'changed@example.com',
          code: '123456',
          password: 'WrongPass1',
        }),
      );

      expect(outcome).toEqual({ ok: false, error: wrongPasswordFailure });
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });

    it('should reject OAuth-only user with AUTH_PASSWORD_NOT_SET', async () => {
      passwordReauthService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_PASSWORD_NOT_SET',
          }),
        ),
      );

      const outcome = await collectResult(
        service.changeEmail('user-1', {
          newEmail: 'changed@example.com',
          code: '123456',
          password: 'AnyPass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_PASSWORD_NOT_SET' }),
      });
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });

    it('should reject when new email is already in use', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      const outcome = await collectResult(
        service.changeEmail('user-1', {
          newEmail: 'test@example.com',
          code: '123456',
          password: 'Passw0rd123',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });

    it('should reject a missing user with RESOURCE_NOT_FOUND', async () => {
      userService.findById.mockResolvedValue(null);

      const outcome = await collectResult(
        service.changeEmail('user-1', {
          newEmail: 'changed@example.com',
          code: '123456',
          password: 'Passw0rd123',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
      });
    });
  });

  // ════════════════════════════════════════════════════════════
  // sendVerificationCode
  // ════════════════════════════════════════════════════════════

  describe('sendVerificationCode', () => {
    it('should send verification code and return message', async () => {
      const outcome = await collectResult(
        service.sendVerificationCode({
          email: 'test@example.com',
          scene: 'register',
        }),
      );

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'register',
        undefined,
        undefined,
      );
      expect(outcome).toEqual({
        ok: true,
        value: { message: 'auth.verification_code_sent' },
      });
    });

    it('should pass clientKey when provided', async () => {
      await collectResult(
        service.sendVerificationCode(
          { email: 'test@example.com', scene: 'login' },
          'client-key-123',
        ),
      );

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'login',
        'client-key-123',
        undefined,
      );
    });

    it('should pass the locale through when provided', async () => {
      await collectResult(
        service.sendVerificationCode(
          { email: 'test@example.com', scene: 'register' },
          'client-key-123',
          'zh-CN',
        ),
      );

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'register',
        'client-key-123',
        'zh-CN',
      );
    });

    it('should propagate cooldown/rate-limit failures from the code service', async () => {
      verificationCodeService.send.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'AUTH_VERIFICATION_CODE_COOLDOWN',
            retryable: true,
            retryAfter: 60,
          }),
        ),
      );

      const outcome = await collectResult(
        service.sendVerificationCode({
          email: 'test@example.com',
          scene: 'register',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_VERIFICATION_CODE_COOLDOWN',
        }),
      });
    });
  });

  // ════════════════════════════════════════════════════════════
  // verifyEmail
  // ════════════════════════════════════════════════════════════

  describe('verifyEmail', () => {
    it('should verify email with Better Auth token', async () => {
      const outcome = await collectResult(
        service.verifyEmail({
          token: 'valid-token',
        }),
      );

      expect(verifyEmailMock).toHaveBeenCalledWith({
        query: { token: 'valid-token' },
      });
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should map invalid token to AUTH_VERIFICATION_CODE_EXPIRED', async () => {
      verifyEmailMock.mockRejectedValue(
        createBetterAuthAPIError('INVALID_TOKEN'),
      );

      const outcome = await collectResult(
        service.verifyEmail({
          token: 'bad-token',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_VERIFICATION_CODE_EXPIRED',
        }),
      });
    });

    it('maps non-business Better Auth errors to DEPENDENCY_UNAVAILABLE', async () => {
      const error = new Error('verification store unavailable');
      verifyEmailMock.mockRejectedValue(error);

      const outcome = await collectResult(
        service.verifyEmail({ token: 'token' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'DEPENDENCY_UNAVAILABLE',
          cause: error,
        }),
      });
    });
  });

  // ════════════════════════════════════════════════════════════
  // mapBetterAuthError
  // ════════════════════════════════════════════════════════════

  describe('mapBetterAuthError', () => {
    it('should map USER_NOT_FOUND to AUTH_WRONG_PASSWORD (anti-enumeration)', async () => {
      verifyEmailMock.mockRejectedValue(
        createBetterAuthAPIError('USER_NOT_FOUND'),
      );

      const outcome = await collectResult(
        service.verifyEmail({ token: 'bad-token' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: wrongPasswordFailure,
      });
    });

    it('should map PASSWORD_ALREADY_SET to RESOURCE_CONFLICT', async () => {
      verifyEmailMock.mockRejectedValue(
        createBetterAuthAPIError('PASSWORD_ALREADY_SET'),
      );

      const outcome = await collectResult(
        service.verifyEmail({ token: 'token' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'RESOURCE_CONFLICT',
        }),
      });
    });

    it('should map disabled config errors to AUTH_METHOD_DISABLED', async () => {
      verifyEmailMock.mockRejectedValue(
        createBetterAuthAPIError('VERIFICATION_EMAIL_NOT_ENABLED'),
      );

      const outcome = await collectResult(
        service.verifyEmail({ token: 'token' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          kind: 'dependency',
          code: 'AUTH_METHOD_DISABLED',
        }),
      });
    });

    it('should map an unknown Better Auth 4xx error to AUTH_WRONG_PASSWORD', async () => {
      verifyEmailMock.mockRejectedValue(
        createBetterAuthAPIError('UNKNOWN_BETTER_AUTH_ERROR'),
      );

      const outcome = await collectResult(
        service.verifyEmail({ token: 'token' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          kind: 'authentication',
          code: 'AUTH_WRONG_PASSWORD',
        }),
      });
    });

    it('should map an unknown Better Auth 5xx error to DEPENDENCY_UNAVAILABLE', async () => {
      verifyEmailMock.mockRejectedValue(
        createBetterAuthAPIError('FAILED_TO_CREATE_SESSION', 500),
      );

      const outcome = await collectResult(
        service.verifyEmail({ token: 'token' }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          kind: 'dependency',
          code: 'DEPENDENCY_UNAVAILABLE',
        }),
      });
    });
  });

  // ════════════════════════════════════════════════════════════
  // forgotPassword
  // ════════════════════════════════════════════════════════════

  describe('forgotPassword', () => {
    it('should send a verification code with the forgot-password scene', async () => {
      const outcome = await collectResult(
        service.forgotPassword({
          email: 'test@example.com',
        }),
      );

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'forgot-password',
        undefined,
        undefined,
      );
      expect(outcome).toEqual({
        ok: true,
        value: { message: 'auth.forgot_password_hint' },
      });
    });

    it('should pass the locale through when provided', async () => {
      const outcome = await collectResult(
        service.forgotPassword(
          { email: 'test@example.com' },
          'client-key-123',
          'zh-CN',
        ),
      );

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'forgot-password',
        'client-key-123',
        'zh-CN',
      );
      expect(outcome).toEqual({
        ok: true,
        value: { message: 'auth.forgot_password_hint' },
      });
    });

    it('should return success even when user does not exist (anti-enumeration)', async () => {
      userService.findByEmail.mockResolvedValue(null);

      const outcome = await collectResult(
        service.forgotPassword({
          email: 'nobody@example.com',
        }),
      );

      expect(outcome).toEqual({
        ok: true,
        value: { message: 'auth.forgot_password_hint' },
      });
    });

    it('should propagate verification-code send failures', async () => {
      verificationCodeService.send.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'AUTH_VERIFICATION_CODE_RATE_LIMITED',
            retryable: true,
            retryAfter: 60,
          }),
        ),
      );

      const outcome = await collectResult(
        service.forgotPassword({
          email: 'test@example.com',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_VERIFICATION_CODE_RATE_LIMITED',
        }),
      });
    });
  });

  // ════════════════════════════════════════════════════════════
  // resetPassword
  // ════════════════════════════════════════════════════════════

  describe('resetPassword', () => {
    beforeEach(() => {
      // The reset flow resolves the user by email first; the suite default is
      // `findByEmail → null`, so restore the found user for the happy path.
      userService.findByEmail.mockResolvedValue(mockUser);
    });

    it('should verify the code, update the password and revoke all sessions', async () => {
      const outcome = await collectResult(
        service.resetPassword({
          email: 'test@example.com',
          code: '123456',
          password: 'NewSecure@Pass1',
        }),
      );

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'forgot-password',
      );
      expect(accountFindFirstMock).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          providerId: 'credential',
        },
      });
      expect(betterAuthAdapter.hashPassword).toHaveBeenCalledWith(
        'NewSecure@Pass1',
      );
      expect(accountUpdateMock).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: { password: '$argon2id$new-hash' },
      });
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-1');
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should reject with AUTH_VERIFICATION_CODE_EXPIRED when the user is not found (anti-enumeration)', async () => {
      userService.findByEmail.mockResolvedValue(null);

      const outcome = await collectResult(
        service.resetPassword({
          email: 'unknown@example.com',
          code: '123456',
          password: 'NewSecure@Pass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_VERIFICATION_CODE_EXPIRED',
        }),
      });
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });

    it('should reject when the verification code does not verify', async () => {
      verificationCodeService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_VERIFICATION_CODE_EXPIRED',
          }),
        ),
      );

      const outcome = await collectResult(
        service.resetPassword({
          email: 'test@example.com',
          code: 'wrong',
          password: 'NewSecure@Pass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_VERIFICATION_CODE_EXPIRED',
        }),
      });
      expect(accountUpdateMock).not.toHaveBeenCalled();
      expect(authTokenService.revokeAll).not.toHaveBeenCalled();
    });

    it('should reject with AUTH_PASSWORD_NOT_SET when the account has no credential', async () => {
      accountFindFirstMock.mockResolvedValue(null);

      const outcome = await collectResult(
        service.resetPassword({
          email: 'test@example.com',
          code: '123456',
          password: 'NewSecure@Pass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_PASSWORD_NOT_SET',
        }),
      });
      expect(accountUpdateMock).not.toHaveBeenCalled();
      expect(authTokenService.revokeAll).not.toHaveBeenCalled();
    });

    it('should map infrastructure failures to DEPENDENCY_UNAVAILABLE', async () => {
      const error = new Error('db connection lost');
      userService.findByEmail.mockRejectedValue(error);

      const outcome = await collectResult(
        service.resetPassword({
          email: 'test@example.com',
          code: '123456',
          password: 'NewSecure@Pass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'DEPENDENCY_UNAVAILABLE',
          cause: error,
        }),
      });
    });
  });
});
