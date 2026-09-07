import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { CredentialAuthService } from './credential.service.js';
import { UserService } from '../../../user/index.js';
import { VerificationCodeService } from './verification-code.service.js';
import { AuthTokenService } from '../token.service.js';
import { AuthRateLimitService } from './rate-limit.service.js';
import { AuthBetterAuthAdapter } from '../../adapters/better-auth.adapter.js';
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

const mockBetterAuthUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Tester',
  image: null,
  emailVerified: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-06-01'),
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
  let betterAuthAdapter: vi.Mocked<AuthBetterAuthAdapter>;

  let signUpEmailMock: vi.Mock;
  let signInEmailMock: vi.Mock;
  let verifyPasswordForUserMock: vi.Mock;
  let revokeBetterAuthSessionsMock: vi.Mock;

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
          provide: AuthBetterAuthAdapter,
          useValue: {
            auth: {
              api: {
                signUpEmail: vi.fn(),
                signInEmail: vi.fn(),
              },
            },
            hashPassword: vi.fn(),
            verifyPassword: vi.fn(),
            verifyPasswordForUser: vi.fn(),
            revokeBetterAuthSessions: vi.fn(),
            credentialProviderId: 'credential',
            credentialIssuer: 'local:credential',
          },
        },
      ],
    }).compile();

    service = module.get(CredentialAuthService);
    userService = module.get(UserService);
    verificationCodeService = module.get(VerificationCodeService);
    authTokenService = module.get(AuthTokenService);
    authRateLimitService = module.get(AuthRateLimitService);
    betterAuthAdapter = module.get(AuthBetterAuthAdapter);

    // Default mock responses
    userService.findByEmail.mockResolvedValue(null);
    userService.findById.mockResolvedValue(mockUser);
    userService.create.mockReturnValue(okAsync(mockUser));
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

    signUpEmailMock = betterAuthAdapter.auth.api
      .signUpEmail as unknown as vi.Mock;
    signInEmailMock = betterAuthAdapter.auth.api
      .signInEmail as unknown as vi.Mock;
    verifyPasswordForUserMock =
      betterAuthAdapter.verifyPasswordForUser as unknown as vi.Mock;
    revokeBetterAuthSessionsMock =
      betterAuthAdapter.revokeBetterAuthSessions as unknown as vi.Mock;

    signUpEmailMock.mockResolvedValue({
      token: null,
      user: mockBetterAuthUser,
    });
    signInEmailMock.mockResolvedValue({
      redirect: false,
      token: 'better-auth-session-token',
      user: mockBetterAuthUser,
    });
    betterAuthAdapter.hashPassword.mockResolvedValue('$argon2id$new-hash');
    betterAuthAdapter.verifyPassword.mockResolvedValue(true);
    verifyPasswordForUserMock.mockReturnValue(okAsync(true));
    revokeBetterAuthSessionsMock.mockReturnValue(okAsync(undefined));
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

    it('maps infrastructure failures to DEPENDENCY_UNAVAILABLE', async () => {
      const error = new Error('db connection lost');
      signUpEmailMock.mockRejectedValue(error);

      const outcome = await collectResult(service.register(buildRegisterDto()));

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

    it('maps a Better Auth internal error to DEPENDENCY_UNAVAILABLE instead of folding it into AUTH_WRONG_PASSWORD', async () => {
      verifyPasswordForUserMock.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'dependency',
            code: 'DEPENDENCY_UNAVAILABLE',
            detail: 'session store unavailable',
          }),
        ),
      );

      const outcome = await collectResult(service.login(buildLoginDto()));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }),
      });
      expect(authRateLimitService.recordLoginFailure).not.toHaveBeenCalled();
      expect(authRateLimitService.clearLoginFailures).not.toHaveBeenCalled();
      expect(userService.update).not.toHaveBeenCalled();
    });

    it('maps infrastructure failures to DEPENDENCY_UNAVAILABLE', async () => {
      const error = new Error('db connection lost');
      userService.findByEmail.mockRejectedValue(error);

      const outcome = await collectResult(service.login(buildLoginDto()));

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
