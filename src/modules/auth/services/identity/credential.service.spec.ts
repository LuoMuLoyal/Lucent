import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { I18nService } from 'nestjs-i18n';

import { CredentialAuthService } from './credential.service';
import { UserService } from '../../../user';
import { VerificationCodeService } from './verification-code.service';
import { AuthTokenService } from '../token.service';
import { AuthRateLimitService } from './rate-limit.service';
import { PasswordReauthService } from './password-reauth.service';
import { NotificationsService } from '../../../notifications';
import { AuthBetterAuthAdapter } from '../../adapters/better-auth.adapter';
import { PrismaService } from '../../../../prisma';
import type { NotificationListItemDto } from '../../../notifications';
import type { User } from '#generated/prisma/client';
import { UserStatus } from '#generated/prisma/client';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';

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
  passwordHash: '$argon2id$hashed',
  nickname: 'Tester',
  avatar: null,
  status: UserStatus.active,
  emailVerifiedAt: new Date('2026-01-01'),
  lastLoginAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-06-01'),
};

const mockBetterAuthUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Tester',
  image: null,
  emailVerified: true,
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

const mockTokenPair = {
  accessToken: 'access-token-xxx',
  refreshToken: 'refresh-token-xxx',
  expiresIn: 3600,
  accessTokenExpiresAt: '2026-06-29T14:00:00.000Z',
  refreshTokenExpiresAt: '2026-07-13T14:00:00.000Z',
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

function buildRegisterDto(overrides: Record<string, unknown> = {}) {
  return {
    email: 'new@example.com',
    password: 'Secure@Pass1',
    code: '123456',
    nickname: 'NewUser',
    ...overrides,
  };
}

function buildLoginDto(overrides: Record<string, unknown> = {}) {
  return {
    email: 'test@example.com',
    password: 'Secure@Pass1',
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────

describe('CredentialAuthService', () => {
  let service: CredentialAuthService;
  let userService: vi.Mocked<UserService>;
  let verificationCodeService: vi.Mocked<VerificationCodeService>;
  let authTokenService: vi.Mocked<AuthTokenService>;
  let authRateLimitService: vi.Mocked<AuthRateLimitService>;
  let passwordReauthService: vi.Mocked<PasswordReauthService>;
  let notificationsService: vi.Mocked<NotificationsService>;
  let betterAuthAdapter: vi.Mocked<AuthBetterAuthAdapter>;
  let prisma: vi.Mocked<PrismaService>;

  let signUpEmailMock: vi.Mock;
  let signInEmailMock: vi.Mock;
  let requestPasswordResetMock: vi.Mock;
  let resetPasswordMock: vi.Mock;
  let verifyEmailMock: vi.Mock;
  let verifyPasswordForUserMock: vi.Mock;
  let revokeBetterAuthSessionsMock: vi.Mock;
  let accountFindFirstMock: vi.Mock;
  let accountUpdateMock: vi.Mock;
  let accountCreateMock: vi.Mock;
  let verificationFindFirstMock: vi.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialAuthService,
        {
          provide: UserService,
          useValue: {
            findByEmail: vi.fn(),
            findById: vi.fn(),
            create: vi.fn(),
            update: vi.fn().mockReturnValue(okAsync(mockUser)),
            updateByEmail: vi.fn(),
          },
        },
        {
          provide: VerificationCodeService,
          useValue: {
            verify: vi.fn(),
            send: vi.fn(),
            assertClientRateLimit: vi.fn(),
          },
        },
        {
          provide: AuthTokenService,
          useValue: {
            generateTokenPair: vi.fn(),
            revokeAll: vi.fn(),
          },
        },
        {
          provide: AuthRateLimitService,
          useValue: {
            checkLoginRateLimit: vi.fn(),
            recordLoginFailure: vi.fn(),
            clearLoginFailures: vi.fn(),
            checkReauthRateLimit: vi.fn(),
            recordReauthFailure: vi.fn(),
            clearReauthFailures: vi.fn(),
          },
        },
        {
          provide: PasswordReauthService,
          useValue: {
            verify: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            create: vi.fn(),
          },
        },
        {
          provide: AuthBetterAuthAdapter,
          useValue: {
            auth: {
              api: {
                signUpEmail: vi.fn(),
                signInEmail: vi.fn(),
                requestPasswordReset: vi.fn(),
                resetPassword: vi.fn(),
                verifyEmail: vi.fn(),
              },
            },
            hashPassword: vi.fn(),
            verifyPassword: vi.fn(),
            verifyPasswordForUser: vi.fn(),
            revokeBetterAuthSessions: vi.fn(),
            getEmailCallbackUrl: vi
              .fn()
              .mockReturnValue('luminous://auth/callback'),
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
            verification: {
              findFirst: vi.fn(),
            },
            userProfile: {
              upsert: vi.fn(),
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

    service = module.get(CredentialAuthService);
    userService = module.get(UserService);
    verificationCodeService = module.get(VerificationCodeService);
    authTokenService = module.get(AuthTokenService);
    authRateLimitService = module.get(AuthRateLimitService);
    passwordReauthService = module.get(PasswordReauthService);
    notificationsService = module.get(NotificationsService);
    betterAuthAdapter = module.get(AuthBetterAuthAdapter);
    prisma = module.get(PrismaService);

    // Default mock responses
    userService.findByEmail.mockResolvedValue(null);
    userService.findById.mockResolvedValue(mockUser);
    userService.create.mockResolvedValue(mockUser);
    userService.update.mockReturnValue(okAsync(mockUser));
    userService.updateByEmail.mockResolvedValue(mockUser);
    authTokenService.generateTokenPair.mockReturnValue(okAsync(mockTokenPair));
    authTokenService.revokeAll.mockReturnValue(okAsync(undefined));
    verificationCodeService.verify.mockReturnValue(okAsync(undefined));
    verificationCodeService.send.mockReturnValue(okAsync(undefined));
    authRateLimitService.checkLoginRateLimit.mockReturnValue(
      okAsync(undefined),
    );
    authRateLimitService.recordLoginFailure.mockReturnValue(okAsync(undefined));
    authRateLimitService.clearLoginFailures.mockReturnValue(okAsync(undefined));
    notificationsService.create.mockReturnValue(okAsync(mockNotification));

    signUpEmailMock = betterAuthAdapter.auth.api
      .signUpEmail as unknown as vi.Mock;
    signInEmailMock = betterAuthAdapter.auth.api
      .signInEmail as unknown as vi.Mock;
    requestPasswordResetMock = betterAuthAdapter.auth.api
      .requestPasswordReset as unknown as vi.Mock;
    resetPasswordMock = betterAuthAdapter.auth.api
      .resetPassword as unknown as vi.Mock;
    verifyEmailMock = betterAuthAdapter.auth.api
      .verifyEmail as unknown as vi.Mock;
    verifyPasswordForUserMock =
      betterAuthAdapter.verifyPasswordForUser as unknown as vi.Mock;
    revokeBetterAuthSessionsMock =
      betterAuthAdapter.revokeBetterAuthSessions as unknown as vi.Mock;
    accountFindFirstMock = prisma.account.findFirst as unknown as vi.Mock;
    accountUpdateMock = prisma.account.update as unknown as vi.Mock;
    accountCreateMock = prisma.account.create as unknown as vi.Mock;
    verificationFindFirstMock = prisma.verification
      .findFirst as unknown as vi.Mock;

    signUpEmailMock.mockResolvedValue({
      token: null,
      user: mockBetterAuthUser,
    });
    signInEmailMock.mockResolvedValue({
      redirect: false,
      token: 'better-auth-session-token',
      user: mockBetterAuthUser,
    });
    requestPasswordResetMock.mockResolvedValue({
      status: true,
      message: 'If this email exists in our system, check your email',
    });
    resetPasswordMock.mockResolvedValue({
      status: true,
    });
    verifyEmailMock.mockResolvedValue({
      status: true,
    });
    betterAuthAdapter.hashPassword.mockResolvedValue('$argon2id$new-hash');
    betterAuthAdapter.verifyPassword.mockResolvedValue(true);
    verifyPasswordForUserMock.mockReturnValue(okAsync(true));
    revokeBetterAuthSessionsMock.mockReturnValue(okAsync(undefined));

    accountFindFirstMock.mockResolvedValue(mockCredentialAccount);
    accountUpdateMock.mockResolvedValue(mockCredentialAccount);
    accountCreateMock.mockResolvedValue(mockCredentialAccount);
    verificationFindFirstMock.mockResolvedValue({
      id: 'v-1',
      identifier: 'reset-password:token',
      value: 'user-1',
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════
  // register
  // ════════════════════════════════════════════════════════════

  describe('register', () => {
    it('should register a new user and return tokens', async () => {
      const dto = buildRegisterDto();
      const outcome = await collectResult(service.register(dto));

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'new@example.com',
        '123456',
        'register',
      );
      expect(signUpEmailMock).toHaveBeenCalledWith({
        body: {
          email: 'new@example.com',
          password: 'Secure@Pass1',
          name: 'NewUser',
        },
      });
      expect(userService.update).toHaveBeenCalledWith('user-1', {
        emailVerified: true,
        emailVerifiedAt: expect.any(Date),
      });
      expect(authTokenService.generateTokenPair).toHaveBeenCalledWith(
        mockUser,
        undefined,
      );
      expect(revokeBetterAuthSessionsMock).toHaveBeenCalledWith('user-1');
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({
          user: mockUser,
          accessToken: mockTokenPair.accessToken,
          refreshToken: mockTokenPair.refreshToken,
        }),
      });
    });

    it('should normalize email and fallback nickname to email local part', async () => {
      const dto = buildRegisterDto({
        email: '  New@Example.COM  ',
        nickname: undefined,
      });
      await collectResult(service.register(dto));

      expect(signUpEmailMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          email: 'new@example.com',
          name: 'new',
        }),
      });
    });

    it('should reject an already-registered email with the generic credential failure (anti-enumeration)', async () => {
      signUpEmailMock.mockResolvedValue({
        token: null,
        user: { ...mockBetterAuthUser, id: 'synthetic-id' },
      });
      userService.findById.mockResolvedValue(null);

      const outcome = await collectResult(service.register(buildRegisterDto()));

      expect(outcome).toEqual({ ok: false, error: wrongPasswordFailure });
    });

    it('should validate the code before calling Better Auth (anti-enumeration)', async () => {
      await collectResult(service.register(buildRegisterDto()));

      const verifyOrder =
        verificationCodeService.verify.mock.invocationCallOrder;
      const signUpOrder = signUpEmailMock.mock.invocationCallOrder;
      expect(verifyOrder[0]!).toBeLessThan(signUpOrder[0]!);
    });

    it('should propagate verification code failures', async () => {
      verificationCodeService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_VERIFICATION_CODE_MISMATCH',
          }),
        ),
      );

      const outcome = await collectResult(service.register(buildRegisterDto()));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_VERIFICATION_CODE_MISMATCH',
        }),
      });
      expect(signUpEmailMock).not.toHaveBeenCalled();
    });

    it('should pass auth context to token generation', async () => {
      const context = { ipAddress: '1.2.3.4', userAgent: 'Test/1.0' };
      await collectResult(service.register(buildRegisterDto(), context));

      expect(authTokenService.generateTokenPair).toHaveBeenCalledWith(
        mockUser,
        context,
      );
    });

    it('should not mask infrastructure failures as business failures', async () => {
      signUpEmailMock.mockRejectedValue(new Error('db connection lost'));

      await expect(
        collectResult(service.register(buildRegisterDto())),
      ).rejects.toThrow('db connection lost');
    });
  });

  // ════════════════════════════════════════════════════════════
  // login
  // ════════════════════════════════════════════════════════════

  describe('login', () => {
    beforeEach(() => {
      userService.findByEmail.mockResolvedValue(mockUser);
    });

    it('should login with correct password and return tokens', async () => {
      const outcome = await collectResult(service.login(buildLoginDto()));

      expect(authRateLimitService.checkLoginRateLimit).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(verifyPasswordForUserMock).toHaveBeenCalledWith(
        'user-1',
        'Secure@Pass1',
      );
      expect(signInEmailMock).not.toHaveBeenCalled();
      expect(authRateLimitService.clearLoginFailures).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(userService.update).toHaveBeenCalledWith('user-1', {
        lastLoginAt: expect.any(Date),
        status: UserStatus.active,
      });
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({
          user: mockUser,
          accessToken: mockTokenPair.accessToken,
        }),
      });
    });

    it('should reject wrong password with the generic code and record the failure', async () => {
      verifyPasswordForUserMock.mockReturnValue(okAsync(false));

      const outcome = await collectResult(service.login(buildLoginDto()));

      expect(verifyPasswordForUserMock).toHaveBeenCalledWith(
        'user-1',
        'Secure@Pass1',
      );
      expect(outcome).toEqual({ ok: false, error: wrongPasswordFailure });
      expect(authRateLimitService.recordLoginFailure).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(authRateLimitService.clearLoginFailures).not.toHaveBeenCalled();
      expect(userService.update).not.toHaveBeenCalled();
    });

    it('should reject a non-existent account with the generic code and record the failure', async () => {
      userService.findByEmail.mockResolvedValue(null);

      const outcome = await collectResult(service.login(buildLoginDto()));

      expect(outcome).toEqual({ ok: false, error: wrongPasswordFailure });
      expect(authRateLimitService.recordLoginFailure).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(signInEmailMock).not.toHaveBeenCalled();
    });

    it('should reject when both password and code are provided', async () => {
      const outcome = await collectResult(
        service.login(buildLoginDto({ code: '123456' })),
      );

      expect(outcome).toEqual({ ok: false, error: wrongPasswordFailure });
      expect(authRateLimitService.recordLoginFailure).toHaveBeenCalledWith(
        'test@example.com',
      );
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
      expect(signInEmailMock).not.toHaveBeenCalled();
    });

    it('should reject OAuth-only user without credential account', async () => {
      verifyPasswordForUserMock.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_PASSWORD_NOT_SET',
          }),
        ),
      );

      const outcome = await collectResult(service.login(buildLoginDto()));

      expect(verifyPasswordForUserMock).toHaveBeenCalledWith(
        'user-1',
        'Secure@Pass1',
      );
      expect(outcome).toEqual({ ok: false, error: wrongPasswordFailure });
      expect(authRateLimitService.recordLoginFailure).toHaveBeenCalledWith(
        'test@example.com',
      );
    });

    it('should login with verification code', async () => {
      const dto = buildLoginDto({ code: '654321', password: undefined });
      const outcome = await collectResult(service.login(dto));

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '654321',
        'login',
      );
      expect(signInEmailMock).not.toHaveBeenCalled();
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({
          user: mockUser,
          accessToken: mockTokenPair.accessToken,
        }),
      });
    });

    it('should normalize email before lookup', async () => {
      await collectResult(
        service.login(buildLoginDto({ email: '  TEST@Example.COM  ' })),
      );

      expect(userService.findByEmail).toHaveBeenCalledWith('test@example.com');
    });

    it('should surface the login rate-limit failure without recording another failure', async () => {
      authRateLimitService.checkLoginRateLimit.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'AUTH_LOGIN_RATE_LIMITED',
            retryable: true,
            retryAfter: 60,
            args: { minutes: 1 },
          }),
        ),
      );

      const outcome = await collectResult(service.login(buildLoginDto()));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_LOGIN_RATE_LIMITED' }),
      });
      expect(userService.findByEmail).not.toHaveBeenCalled();
      expect(authRateLimitService.recordLoginFailure).not.toHaveBeenCalled();
    });

    it('should rethrow a Better Auth internal error instead of folding it into AUTH_WRONG_PASSWORD', async () => {
      verifyPasswordForUserMock.mockReturnValue(
        fromPromise(
          Promise.reject(new Error('session store unavailable')),
          (error) => {
            throw error;
          },
        ),
      );

      await expect(
        collectResult(service.login(buildLoginDto())),
      ).rejects.toThrow('session store unavailable');
      expect(authRateLimitService.recordLoginFailure).not.toHaveBeenCalled();
      expect(authRateLimitService.clearLoginFailures).not.toHaveBeenCalled();
      expect(userService.update).not.toHaveBeenCalled();
    });

    it('should not mask infrastructure failures as business failures', async () => {
      userService.findByEmail.mockRejectedValue(
        new Error('db connection lost'),
      );

      await expect(
        collectResult(service.login(buildLoginDto())),
      ).rejects.toThrow('db connection lost');
    });
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

    it('should rethrow non-business Better Auth errors', async () => {
      verifyEmailMock.mockRejectedValue(
        new Error('verification store unavailable'),
      );

      await expect(
        collectResult(service.verifyEmail({ token: 'token' })),
      ).rejects.toThrow('verification store unavailable');
    });
  });

  // ════════════════════════════════════════════════════════════
  // forgotPassword
  // ════════════════════════════════════════════════════════════

  describe('forgotPassword', () => {
    beforeEach(() => {
      verificationCodeService.assertClientRateLimit.mockReturnValue(
        okAsync(undefined),
      );
    });

    it('should request a Better Auth password reset email', async () => {
      const outcome = await collectResult(
        service.forgotPassword({
          email: 'test@example.com',
        }),
      );

      expect(
        verificationCodeService.assertClientRateLimit,
      ).toHaveBeenCalledWith(undefined);
      expect(requestPasswordResetMock).toHaveBeenCalledWith({
        body: {
          email: 'test@example.com',
          redirectTo: 'luminous://auth/callback',
        },
      });
      expect(outcome).toEqual({
        ok: true,
        value: { message: 'auth.forgot_password_hint' },
      });
    });

    it('should return success even when user does not exist (anti-enumeration)', async () => {
      requestPasswordResetMock.mockResolvedValue({
        status: true,
        message: 'If this email exists in our system, check your email',
      });

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

    it('should propagate client rate-limit failures', async () => {
      verificationCodeService.assertClientRateLimit.mockReturnValue(
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
      expect(requestPasswordResetMock).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════
  // resetPassword
  // ════════════════════════════════════════════════════════════

  describe('resetPassword', () => {
    it('should reset password and revoke all sessions', async () => {
      const outcome = await collectResult(
        service.resetPassword({
          token: 'token',
          password: 'NewSecure@Pass1',
        }),
      );

      expect(verificationFindFirstMock).toHaveBeenCalledWith({
        where: { identifier: 'reset-password:token' },
      });
      expect(resetPasswordMock).toHaveBeenCalledWith({
        body: { token: 'token', newPassword: 'NewSecure@Pass1' },
      });
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-1');
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should reject when reset token is not found', async () => {
      verificationFindFirstMock.mockResolvedValue(null);

      const outcome = await collectResult(
        service.resetPassword({
          token: 'unknown-token',
          password: 'NewSecure@Pass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_VERIFICATION_CODE_EXPIRED',
        }),
      });
      expect(resetPasswordMock).not.toHaveBeenCalled();
      expect(authTokenService.revokeAll).not.toHaveBeenCalled();
    });

    it('should map Better Auth INVALID_TOKEN to AUTH_VERIFICATION_CODE_EXPIRED', async () => {
      resetPasswordMock.mockRejectedValue(
        createBetterAuthAPIError('INVALID_TOKEN'),
      );

      const outcome = await collectResult(
        service.resetPassword({
          token: 'expired-token',
          password: 'NewSecure@Pass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_VERIFICATION_CODE_EXPIRED',
        }),
      });
    });

    it('should not mask infrastructure failures', async () => {
      verificationFindFirstMock.mockRejectedValue(
        new Error('db connection lost'),
      );

      await expect(
        collectResult(
          service.resetPassword({
            token: 'token',
            password: 'NewSecure@Pass1',
          }),
        ),
      ).rejects.toThrow('db connection lost');
    });
  });
});
