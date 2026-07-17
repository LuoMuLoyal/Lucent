import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { CredentialAuthService } from './credential.service';
import { UserService } from '../../../user/services/user.service';
import { VerificationCodeService } from './verification-code.service';
import { AuthTokenService } from '../token.service';
import { AuthRateLimitService } from './rate-limit.service';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import type { NotificationListItemDto } from '../../../notifications/dto/response.dto';
import { ResultCode } from '../../../../common/api';
import type { User } from '#generated/prisma/client';
import { UserStatus } from '#generated/prisma/client';

// ── Module-level argon2 mock ──────────────────────────────────

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(),
  verify: vi.fn(),
}));

import * as argon2 from 'argon2';

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
            update: vi.fn(),
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
    userService.update.mockResolvedValue(mockUser);
    authTokenService.generateTokenPair.mockResolvedValue(mockTokenPair);
    authTokenService.revokeAll.mockResolvedValue(undefined);
    verificationCodeService.verify.mockResolvedValue(true);
    verificationCodeService.send.mockResolvedValue(undefined);
    authRateLimitService.checkLoginRateLimit.mockResolvedValue(undefined);
    authRateLimitService.recordLoginFailure.mockResolvedValue(undefined);
    authRateLimitService.clearLoginFailures.mockResolvedValue(undefined);
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
      const result = await service.register(dto);

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
      expect(result.user).toBe(mockUser);
      expect(result.accessToken).toBe(mockTokenPair.accessToken);
      expect(result.refreshToken).toBe(mockTokenPair.refreshToken);
    });

    it('should normalize email to lowercase and trim', async () => {
      const dto = buildRegisterDto({ email: '  New@Example.COM  ' });
      await service.register(dto);

      expect(userService.findByEmail).toHaveBeenCalledWith('new@example.com');
    });

    it('should reject when email is already registered', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      await expect(service.register(buildRegisterDto())).rejects.toThrow(
        HttpException,
      );
    });

    it('should propagate verification code errors', async () => {
      verificationCodeService.verify.mockRejectedValue(
        new UnauthorizedException({
          code: ResultCode.VERIFICATION_CODE_INVALID,
          message: 'invalid code',
        }),
      );

      await expect(service.register(buildRegisterDto())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should pass auth context to token generation', async () => {
      const context = { ipAddress: '1.2.3.4', userAgent: 'Test/1.0' };
      await service.register(buildRegisterDto(), context);

      expect(authTokenService.generateTokenPair).toHaveBeenCalledWith(
        mockUser,
        context,
      );
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
      const result = await service.login(buildLoginDto());

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
      expect(result.accessToken).toBe(mockTokenPair.accessToken);
      expect(result).not.toHaveProperty('requiresTwoFactor');
      expect(result).not.toHaveProperty('tempToken');
    });

    it('should reject wrong password and record failure', async () => {
      (argon2.verify as vi.Mock).mockResolvedValue(false);

      await expect(service.login(buildLoginDto())).rejects.toThrow(
        UnauthorizedException,
      );

      expect(authRateLimitService.recordLoginFailure).toHaveBeenCalledWith(
        'test@example.com',
      );
    });

    it('should reject non-existent account', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(service.login(buildLoginDto())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject when both password and code are provided', async () => {
      await expect(
        service.login(buildLoginDto({ code: '123456' })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject OAuth user without passwordHash', async () => {
      userService.findByEmail.mockResolvedValue({
        ...mockUser,
        passwordHash: null,
      });

      await expect(service.login(buildLoginDto())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should login with verification code', async () => {
      const dto = buildLoginDto({ code: '654321', password: undefined });
      const result = await service.login(dto);

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '654321',
        'login',
      );
      expect(argon2.verify).not.toHaveBeenCalled();
      expect(result.accessToken).toBe(mockTokenPair.accessToken);
    });

    it('should normalize email before lookup', async () => {
      await service.login(buildLoginDto({ email: '  TEST@Example.COM  ' }));

      expect(userService.findByEmail).toHaveBeenCalledWith('test@example.com');
    });
  });

  // ════════════════════════════════════════════════════════════
  // changePassword
  // ════════════════════════════════════════════════════════════

  describe('changePassword', () => {
    it('should change password and revoke all sessions', async () => {
      await service.changePassword('user-1', {
        oldPassword: 'OldPass1',
        newPassword: 'NewPass1',
      });

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
    });

    it('should reject wrong old password', async () => {
      (argon2.verify as vi.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', {
          oldPassword: 'WrongOld',
          newPassword: 'NewPass1',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject OAuth-only user without password hash', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        passwordHash: null,
      });

      await expect(
        service.changePassword('user-1', {
          oldPassword: 'Old',
          newPassword: 'New',
        }),
      ).rejects.toThrow(UnauthorizedException);
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
      await service.setPassword('user-1', {
        code: '123456',
        password: 'NewPass1',
      });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'set-password',
      );
      expect(argon2.hash).toHaveBeenCalledWith('NewPass1', expect.anything());
      expect(authTokenService.revokeAll).toHaveBeenCalledWith('user-1');
    });

    it('should reject when user already has a password', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        passwordHash: '$argon2id$old',
      });

      await expect(
        service.setPassword('user-1', {
          code: '123456',
          password: 'NewPass1',
        }),
      ).rejects.toThrow(HttpException);
    });

    it('should bind new email when user has no email', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        email: null,
        passwordHash: null,
      });

      await service.setPassword('user-1', {
        email: 'bound@example.com',
        code: '123456',
        password: 'NewPass1',
      });

      expect(userService.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ email: 'bound@example.com' }),
      );
    });

    it('should reject when no email and no provided email', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        email: null,
        passwordHash: null,
      });

      await expect(
        service.setPassword('user-1', {
          code: '123456',
          password: 'NewPass1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ════════════════════════════════════════════════════════════
  // changeEmail
  // ════════════════════════════════════════════════════════════

  describe('changeEmail', () => {
    it('should change email after code verification', async () => {
      await service.changeEmail('user-1', {
        newEmail: 'changed@example.com',
        code: '123456',
      });

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
    });

    it('should reject when new email is already in use', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.changeEmail('user-1', {
          newEmail: 'test@example.com',
          code: '123456',
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  // ════════════════════════════════════════════════════════════
  // sendVerificationCode
  // ════════════════════════════════════════════════════════════

  describe('sendVerificationCode', () => {
    it('should send verification code and return message', async () => {
      const result = await service.sendVerificationCode({
        email: 'test@example.com',
        scene: 'register',
      });

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'register',
        undefined,
      );
      expect(result).toEqual({
        message: 'auth.verification_code_sent',
      });
    });

    it('should pass clientKey when provided', async () => {
      await service.sendVerificationCode(
        { email: 'test@example.com', scene: 'login' },
        'client-key-123',
      );

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'login',
        'client-key-123',
      );
    });
  });

  // ════════════════════════════════════════════════════════════
  // verifyEmail
  // ════════════════════════════════════════════════════════════

  describe('verifyEmail', () => {
    it('should verify email and update emailVerifiedAt', async () => {
      await service.verifyEmail({
        email: 'test@example.com',
        code: '123456',
      });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'register',
      );
      expect(userService.updateByEmail).toHaveBeenCalledWith(
        'test@example.com',

        { emailVerifiedAt: expect.any(Date) },
      );
    });
  });

  // ════════════════════════════════════════════════════════════
  // forgotPassword
  // ════════════════════════════════════════════════════════════

  describe('forgotPassword', () => {
    beforeEach(() => {
      verificationCodeService.assertClientRateLimit.mockResolvedValue(
        undefined,
      );
    });

    it('should send reset code when user exists', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      const result = await service.forgotPassword({
        email: 'test@example.com',
      });

      expect(
        verificationCodeService.assertClientRateLimit,
      ).toHaveBeenCalledWith(undefined);
      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'reset-password',
      );
      expect(result).toEqual({
        message: 'auth.forgot_password_hint',
      });
    });

    it('should return success even when user does not exist (anti-enumeration)', async () => {
      userService.findByEmail.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'nobody@example.com',
      });

      expect(verificationCodeService.send).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: 'auth.forgot_password_hint',
      });
    });
  });

  // ════════════════════════════════════════════════════════════
  // resetPassword
  // ════════════════════════════════════════════════════════════

  describe('resetPassword', () => {
    it('should reset password and revoke all sessions', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      await service.resetPassword({
        email: 'test@example.com',
        code: '123456',
        password: 'NewSecure@Pass1',
      });

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
    });

    it('should reject when user not found after code verification', async () => {
      userService.findByEmail.mockResolvedValue(null);
      verificationCodeService.verify.mockResolvedValue(true);

      await expect(
        service.resetPassword({
          email: 'nobody@example.com',
          code: '123456',
          password: 'NewSecure@Pass1',
        }),
      ).rejects.toThrow(HttpException);
    });
  });
});
