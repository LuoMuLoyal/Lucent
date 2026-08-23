import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { I18nService } from 'nestjs-i18n';

import { CredentialAuthService } from './credential.service';
import { UserService } from '../../../user';
import { VerificationCodeService } from './verification-code.service';
import { AuthTokenService } from '../token.service';
import { AuthRateLimitService } from './rate-limit.service';
import { NotificationsService } from '../../../notifications';
import type { NotificationListItemDto } from '../../../notifications';
import type { User } from '#generated/prisma/client';
import { UserStatus } from '#generated/prisma/client';
import {
  createDomainFailure,
  errAsync,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';

// ── Module-level argon2 mock ──────────────────────────────────

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(),
  verify: vi.fn(),
}));

import * as argon2 from 'argon2';

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

// ── Fixtures ──────────────────────────────────────────────────

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  passwordHash: '$argon2id$hashed',
  nickname: 'Tester',
  avatar: null,
  status: UserStatus.active,
  emailVerifiedAt: new Date('2026-01-01'),
  lastLoginAt: new Date('2026-01-01T00:00:00Z'),
  securityPinEnabled: false,
  securityPinHash: null,
  securityPinChangedAt: null,
  securityElevationVersion: 0,
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
  let notificationsService: vi.Mocked<NotificationsService>;

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
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            create: vi.fn(),
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
    notificationsService = module.get(NotificationsService);

    // Default mock responses
    (argon2.hash as vi.Mock).mockResolvedValue('$argon2id$new-hash');
    (argon2.verify as vi.Mock).mockResolvedValue(true);
    userService.findByEmail.mockResolvedValue(null);
    userService.findById.mockResolvedValue(mockUser);
    userService.create.mockResolvedValue(mockUser);
    userService.update.mockReturnValue(okAsync(mockUser));
    userService.updateByEmail.mockResolvedValue(mockUser);
    authTokenService.generateTokenPair.mockResolvedValue(mockTokenPair);
    authTokenService.revokeAll.mockResolvedValue(undefined);
    verificationCodeService.verify.mockReturnValue(okAsync(undefined));
    verificationCodeService.send.mockReturnValue(okAsync(undefined));
    authRateLimitService.checkLoginRateLimit.mockReturnValue(
      okAsync(undefined),
    );
    authRateLimitService.recordLoginFailure.mockReturnValue(okAsync(undefined));
    authRateLimitService.clearLoginFailures.mockReturnValue(okAsync(undefined));
    notificationsService.create.mockResolvedValue(mockNotification);
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
      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          nickname: 'NewUser',
        }),
      );
      expect(authTokenService.generateTokenPair).toHaveBeenCalledWith(
        mockUser,
        undefined,
      );
      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({
          user: mockUser,
          accessToken: mockTokenPair.accessToken,
          refreshToken: mockTokenPair.refreshToken,
        }),
      });
    });

    it('should normalize email to lowercase and trim', async () => {
      const dto = buildRegisterDto({ email: '  New@Example.COM  ' });
      await collectResult(service.register(dto));

      expect(userService.findByEmail).toHaveBeenCalledWith('new@example.com');
    });

    it('should reject an already-registered email with the generic credential failure (anti-enumeration)', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      const outcome = await collectResult(service.register(buildRegisterDto()));

      expect(outcome).toEqual({ ok: false, error: wrongPasswordFailure });
    });

    it('should validate the code before the email-existence check (anti-enumeration)', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      await collectResult(service.register(buildRegisterDto()));

      const verifyOrder =
        verificationCodeService.verify.mock.invocationCallOrder;
      const lookupOrder = userService.findByEmail.mock.invocationCallOrder;
      expect(verifyOrder[0]!).toBeLessThan(lookupOrder[0]!);
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
      expect(userService.create).not.toHaveBeenCalled();
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
      userService.create.mockRejectedValue(new Error('db connection lost'));

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
      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$hashed',
        'Secure@Pass1',
      );
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
      (argon2.verify as vi.Mock).mockResolvedValue(false);

      const outcome = await collectResult(service.login(buildLoginDto()));

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
    });

    it('should reject OAuth user without passwordHash', async () => {
      userService.findByEmail.mockResolvedValue({
        ...mockUser,
        passwordHash: null,
      });

      const outcome = await collectResult(service.login(buildLoginDto()));

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
      expect(argon2.verify).not.toHaveBeenCalled();
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

    it('should rethrow an argon2.verify failure instead of folding it into AUTH_WRONG_PASSWORD', async () => {
      (argon2.verify as vi.Mock).mockRejectedValue(new Error('malformed hash'));

      await expect(
        collectResult(service.login(buildLoginDto())),
      ).rejects.toThrow('malformed hash');
      // Dependency-level Argon2 failures are not credential mismatches and
      // must not count against the login failure rate limit.
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
          oldPassword: 'OldPass1',
          newPassword: 'NewPass1',
        }),
      );

      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$hashed',
        'OldPass1',
      );
      expect(argon2.hash).toHaveBeenCalledWith('NewPass1', expect.anything());
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-1');
      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'password_changed' }),
      );
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should reject wrong old password with AUTH_WRONG_PASSWORD', async () => {
      (argon2.verify as vi.Mock).mockResolvedValue(false);

      const outcome = await collectResult(
        service.changePassword('user-1', {
          oldPassword: 'WrongOld',
          newPassword: 'NewPass1',
        }),
      );

      expect(outcome).toEqual({ ok: false, error: wrongPasswordFailure });
      expect(authTokenService.revokeAll).not.toHaveBeenCalled();
    });

    it('should rethrow an argon2.verify failure instead of AUTH_WRONG_PASSWORD', async () => {
      (argon2.verify as vi.Mock).mockRejectedValue(new Error('corrupted hash'));

      await expect(
        collectResult(
          service.changePassword('user-1', {
            oldPassword: 'OldPass1',
            newPassword: 'NewPass1',
          }),
        ),
      ).rejects.toThrow('corrupted hash');
      expect(authTokenService.revokeAll).not.toHaveBeenCalled();
    });

    it('should reject OAuth-only user without password hash', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        passwordHash: null,
      });

      const outcome = await collectResult(
        service.changePassword('user-1', {
          oldPassword: 'Old',
          newPassword: 'New',
        }),
      );

      expect(outcome).toEqual({ ok: false, error: wrongPasswordFailure });
    });

    it('should reject a missing user with RESOURCE_NOT_FOUND', async () => {
      userService.findById.mockResolvedValue(null);

      const outcome = await collectResult(
        service.changePassword('user-1', {
          oldPassword: 'Old',
          newPassword: 'New',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
      });
    });

    it('should still succeed when the password-changed notification fails (best-effort)', async () => {
      notificationsService.create.mockRejectedValue(
        new Error('notification down'),
      );

      const outcome = await collectResult(
        service.changePassword('user-1', {
          oldPassword: 'OldPass1',
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
      userService.findById.mockResolvedValue({
        ...mockUser,
        passwordHash: null,
      });
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
      expect(argon2.hash).toHaveBeenCalledWith('NewPass1', expect.anything());
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-1');
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should reject when user already has a password', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        passwordHash: '$argon2id$old',
      });

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

    it('should bind new email when user has no email', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        email: null,
        passwordHash: null,
      });

      const outcome = await collectResult(
        service.setPassword('user-1', {
          email: 'bound@example.com',
          code: '123456',
          password: 'NewPass1',
        }),
      );

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'bound@example.com',
        '123456',
        'set-password',
      );
      expect(userService.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ email: 'bound@example.com' }),
      );
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should reject when the target email is owned by another user', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        email: null,
        passwordHash: null,
      });
      userService.findByEmail.mockResolvedValue({
        ...mockUser,
        id: 'other-user',
      });

      const outcome = await collectResult(
        service.setPassword('user-1', {
          email: 'bound@example.com',
          code: '123456',
          password: 'NewPass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_CONFLICT' }),
      });
    });

    it('should reject when no email and no provided email', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        email: null,
        passwordHash: null,
      });

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
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════
  // changeEmail
  // ════════════════════════════════════════════════════════════

  describe('changeEmail', () => {
    it('should change email after code verification', async () => {
      const outcome = await collectResult(
        service.changeEmail('user-1', {
          newEmail: 'changed@example.com',
          code: '123456',
        }),
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

    it('should reject when new email is already in use', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      const outcome = await collectResult(
        service.changeEmail('user-1', {
          newEmail: 'test@example.com',
          code: '123456',
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
    it('should verify email and update emailVerifiedAt', async () => {
      const outcome = await collectResult(
        service.verifyEmail({
          email: 'test@example.com',
          code: '123456',
        }),
      );

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'register',
      );
      expect(userService.updateByEmail).toHaveBeenCalledWith(
        'test@example.com',
        { emailVerifiedAt: expect.any(Date) },
      );
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should propagate code mismatch failures', async () => {
      verificationCodeService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_VERIFICATION_CODE_MISMATCH',
          }),
        ),
      );

      const outcome = await collectResult(
        service.verifyEmail({
          email: 'test@example.com',
          code: '999999',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_VERIFICATION_CODE_MISMATCH',
        }),
      });
      expect(userService.updateByEmail).not.toHaveBeenCalled();
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

    it('should send reset code when user exists', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      const outcome = await collectResult(
        service.forgotPassword({
          email: 'test@example.com',
        }),
      );

      expect(
        verificationCodeService.assertClientRateLimit,
      ).toHaveBeenCalledWith(undefined);
      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'reset-password',
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

      expect(verificationCodeService.send).not.toHaveBeenCalled();
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
      expect(verificationCodeService.send).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════
  // resetPassword
  // ════════════════════════════════════════════════════════════

  describe('resetPassword', () => {
    it('should reset password and revoke all sessions', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

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
        'reset-password',
      );
      expect(argon2.hash).toHaveBeenCalledWith(
        'NewSecure@Pass1',
        expect.anything(),
      );
      expect(userService.update).toHaveBeenCalledWith('user-1', {
        passwordHash: '$argon2id$new-hash',
      });
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-1');
      expect(outcome).toEqual({ ok: true, value: undefined });
    });

    it('should reject when user not found after code verification', async () => {
      userService.findByEmail.mockResolvedValue(null);
      verificationCodeService.verify.mockReturnValue(okAsync(undefined));

      const outcome = await collectResult(
        service.resetPassword({
          email: 'nobody@example.com',
          code: '123456',
          password: 'NewSecure@Pass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }),
      });
      expect(authTokenService.revokeAll).not.toHaveBeenCalled();
    });

    it('should propagate code mismatch failures without touching the account', async () => {
      verificationCodeService.verify.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_VERIFICATION_CODE_MISMATCH',
          }),
        ),
      );

      const outcome = await collectResult(
        service.resetPassword({
          email: 'test@example.com',
          code: '999999',
          password: 'NewSecure@Pass1',
        }),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_VERIFICATION_CODE_MISMATCH',
        }),
      });
      expect(userService.update).not.toHaveBeenCalled();
    });
  });
});
