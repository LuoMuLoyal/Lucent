import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { I18nService } from 'nestjs-i18n';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';

import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { VerificationCodeService } from './verification-code.service';
import { UserStatus } from '../generated/prisma/client';

jest.mock('argon2', () => ({
  argon2id: 2,
  hash: jest.fn(),
  verify: jest.fn(),
  Options: {},
}));

const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  passwordHash: '$argon2id$mock',
  nickname: 'TestUser',
  avatar: null,
  status: UserStatus.active,
  emailVerifiedAt: null,
  lastLoginAt: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const mockJwtConfig = {
  accessSecret: 'test-access-secret',
  refreshSecret: 'test-refresh-secret',
  accessTtl: 900,
  refreshTtl: 1_209_600,
};

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: jest.Mocked<PrismaService>;
  let userService: jest.Mocked<UserService>;
  let jwtService: jest.Mocked<JwtService>;
  let verificationCodeService: jest.Mocked<VerificationCodeService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            userSession: {
              create: jest.fn(),
              findUnique: jest.fn(),
              delete: jest.fn(),
              deleteMany: jest.fn(),
            },
            user: {
              update: jest.fn(),
            },
          },
        },
        {
          provide: UserService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateByEmail: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue(mockJwtConfig),
          },
        },
        {
          provide: VerificationCodeService,
          useValue: {
            send: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: I18nService,
          useValue: {
            t: jest.fn((key: string) => key),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    prismaService = module.get(PrismaService);
    userService = module.get(UserService);
    jwtService = module.get(JwtService);
    verificationCodeService = module.get(VerificationCodeService);

    (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$newhash');
    (argon2.verify as jest.Mock).mockResolvedValue(true);
    jwtService.signAsync.mockResolvedValue('mock-jwt-token');
    (prismaService.userSession.create as jest.Mock).mockResolvedValue({
      id: 'session-id',
      userId: mockUser.id,
      refreshTokenHash: hashRefreshToken('created-token'),
      deviceType: null,
      deviceName: null,
      platform: null,
      appVersion: null,
      ipAddress: null,
      userAgent: null,
      context: null,
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + 14 * 86_400 * 1000),
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('register', () => {
    it('should register a new user and return user + tokens', async () => {
      const verifiedUser = {
        ...mockUser,
        emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
      };
      userService.findByEmail.mockResolvedValue(null);
      userService.create.mockResolvedValue(verifiedUser);

      const result = await service.register({
        email: 'TEST@example.com',
        password: 'Password123!',
        code: '123456',
        nickname: 'TestUser',
      });

      expect(userService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'register',
      );
      expect(argon2.hash).toHaveBeenCalledWith(
        'Password123!',
        expect.objectContaining({ type: argon2.argon2id }),
      );
      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          passwordHash: '$argon2id$newhash',
          nickname: 'TestUser',
          emailVerifiedAt: expect.any(Date) as Date,
          profile: { create: {} },
        }),
      );
      expect(result.user).toEqual(verifiedUser);
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.refreshToken).toBeDefined();
    });

    it('should throw ConflictException if email already exists', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'Password123!',
          code: '123456',
        }),
      ).rejects.toThrow(ConflictException);
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should login with valid password and return user + tokens', async () => {
      const updatedUser = {
        ...mockUser,
        lastLoginAt: new Date('2026-01-02T00:00:00Z'),
      };
      userService.findByEmail.mockResolvedValue(mockUser);
      userService.update.mockResolvedValue(updatedUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'test@example.com',
        password: 'Password123!',
      });

      expect(argon2.verify).toHaveBeenCalledWith(
        mockUser.passwordHash,
        'Password123!',
      );
      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        lastLoginAt: expect.any(Date) as Date,
        status: UserStatus.active,
      });
      expect(result.user).toEqual(updatedUser);
      expect(result.accessToken).toBe('mock-jwt-token');
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'noone@example.com', password: 'Password123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when no credential is provided', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockClear();
      verificationCodeService.verify.mockClear();

      await expect(
        service.login({ email: 'test@example.com' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(argon2.verify).not.toHaveBeenCalled();
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when both password and code are provided', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockClear();
      verificationCodeService.verify.mockClear();

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'Password123!',
          code: '123456',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(argon2.verify).not.toHaveBeenCalled();
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });

    it('should login with verification code', async () => {
      const updatedUser = {
        ...mockUser,
        lastLoginAt: new Date('2026-01-02T00:00:00Z'),
      };
      userService.findByEmail.mockResolvedValue(mockUser);
      userService.update.mockResolvedValue(updatedUser);
      verificationCodeService.verify.mockResolvedValue(true);

      const result = await service.login({
        email: 'test@example.com',
        code: '123456',
      });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'login',
      );
      expect(result.user).toEqual(updatedUser);
    });
  });

  describe('refresh', () => {
    it('should rotate refresh token and return new token pair', async () => {
      const refreshToken = 'old-refresh-token';
      const mockRefreshRecord = {
        id: 'session-id',
        userId: 'user-uuid-1',
        refreshTokenHash: hashRefreshToken(refreshToken),
        deviceType: null,
        deviceName: null,
        platform: null,
        appVersion: null,
        ipAddress: null,
        userAgent: null,
        context: null,
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400 * 1000),
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: mockUser,
      };

      (prismaService.userSession.findUnique as jest.Mock).mockResolvedValue(
        mockRefreshRecord,
      );
      (prismaService.userSession.delete as jest.Mock).mockResolvedValue(
        mockRefreshRecord,
      );

      const result = await service.refresh(refreshToken);

      expect(prismaService.userSession.findUnique).toHaveBeenCalledWith({
        where: { refreshTokenHash: hashRefreshToken(refreshToken) },
        include: { user: true },
      });
      expect(prismaService.userSession.delete).toHaveBeenCalledWith({
        where: { id: 'session-id' },
      });
      expect(prismaService.userSession.deleteMany).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('mock-jwt-token');
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      (prismaService.userSession.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.refresh('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for expired refresh token', async () => {
      (prismaService.userSession.findUnique as jest.Mock).mockResolvedValue({
        id: 'session-id',
        userId: 'user-uuid-1',
        refreshTokenHash: hashRefreshToken('expired-token'),
        deviceType: null,
        deviceName: null,
        platform: null,
        appVersion: null,
        ipAddress: null,
        userAgent: null,
        context: null,
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() - 86_400 * 1000),
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: mockUser,
      });

      await expect(service.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should delete the refresh token session', async () => {
      (prismaService.userSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await service.logout('some-refresh-token');

      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: { refreshTokenHash: hashRefreshToken('some-refresh-token') },
      });
    });
  });

  describe('logoutAll', () => {
    it('should delete all refresh token sessions for a user', async () => {
      (prismaService.userSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 3,
      });

      await service.logoutAll('user-uuid-1');

      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
    });
  });

  describe('getMe', () => {
    it('should return user by id', async () => {
      userService.findById.mockResolvedValue(mockUser);

      const result = await service.getMe('user-uuid-1');

      expect(userService.findById).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException if user not found', async () => {
      userService.findById.mockResolvedValue(null);

      await expect(service.getMe('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateMe', () => {
    it('should update nickname and avatar', async () => {
      const updatedUser = {
        ...mockUser,
        nickname: 'NewName',
        avatar: 'https://example.com/avatar.png',
      };
      userService.update.mockResolvedValue(updatedUser);

      const result = await service.updateMe('user-uuid-1', {
        nickname: 'NewName',
        avatar: 'https://example.com/avatar.png',
      });

      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        nickname: 'NewName',
        avatar: 'https://example.com/avatar.png',
      });
      expect(result.nickname).toBe('NewName');
    });
  });

  describe('changePassword', () => {
    it('should change password and logout all devices', async () => {
      userService.findById.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      userService.update.mockResolvedValue(mockUser);
      (prismaService.userSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await service.changePassword('user-uuid-1', {
        oldPassword: 'OldPass123!',
        newPassword: 'NewPass456!',
      });

      expect(argon2.verify).toHaveBeenCalledWith(
        mockUser.passwordHash,
        'OldPass123!',
      );
      expect(argon2.hash).toHaveBeenCalledWith(
        'NewPass456!',
        expect.objectContaining({ type: argon2.argon2id }),
      );
      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        passwordHash: '$argon2id$newhash',
      });
      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
    });

    it('should throw UnauthorizedException for wrong old password', async () => {
      userService.findById.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-uuid-1', {
          oldPassword: 'WrongOldPass!',
          newPassword: 'NewPass456!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changeEmail', () => {
    it('should change email after verification', async () => {
      userService.findById.mockResolvedValue(mockUser);
      verificationCodeService.verify.mockResolvedValue(true);
      userService.findByEmail.mockResolvedValue(null);
      userService.update.mockResolvedValue({
        ...mockUser,
        email: 'new@example.com',
        emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
      });

      await service.changeEmail('user-uuid-1', {
        newEmail: 'NEW@example.com',
        code: '654321',
      });

      expect(userService.findById).toHaveBeenCalledWith('user-uuid-1');
      expect(userService.findByEmail).toHaveBeenCalledWith('new@example.com');
      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'new@example.com',
        '654321',
        'change-email',
      );
      expect(userService.update).toHaveBeenCalledWith('user-uuid-1', {
        email: 'new@example.com',
        emailVerifiedAt: expect.any(Date) as Date,
      });
    });

    it('should throw ConflictException if new email already taken', async () => {
      userService.findById.mockResolvedValue(mockUser);
      userService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.changeEmail('user-uuid-1', {
          newEmail: 'taken@example.com',
          code: '654321',
        }),
      ).rejects.toThrow(ConflictException);
      expect(verificationCodeService.verify).not.toHaveBeenCalled();
    });
  });

  describe('deleteAccount', () => {
    it('should soft-delete user after password verification', async () => {
      userService.findById.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      (prismaService.userSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prismaService.user.update as jest.Mock).mockResolvedValue({
        ...mockUser,
        deletedAt: new Date('2026-01-02T00:00:00Z'),
        status: UserStatus.deleted,
      });

      await service.deleteAccount('user-uuid-1', { password: 'Password123!' });

      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: {
          deletedAt: expect.any(Date) as Date,
          status: UserStatus.deleted,
        },
      });
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      userService.findById.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.deleteAccount('user-uuid-1', { password: 'WrongPass!' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('sendVerificationCode', () => {
    it('should delegate to verificationCodeService.send', async () => {
      verificationCodeService.send.mockResolvedValue(undefined);

      const result = await service.sendVerificationCode({
        email: 'TEST@example.com',
        scene: 'register',
      });

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'register',
      );
      expect(result.message).toBe('auth.verification_code_sent');
    });
  });

  describe('verifyEmail', () => {
    it('should verify code and mark email as verified', async () => {
      verificationCodeService.verify.mockResolvedValue(true);
      userService.updateByEmail.mockResolvedValue({
        ...mockUser,
        emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
      });

      await service.verifyEmail({ email: 'TEST@example.com', code: '123456' });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'register',
      );
      expect(userService.updateByEmail).toHaveBeenCalledWith(
        'test@example.com',
        {
          emailVerifiedAt: expect.any(Date) as Date,
        },
      );
    });
  });

  describe('forgotPassword', () => {
    it('should send reset code if user exists', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      verificationCodeService.send.mockResolvedValue(undefined);

      const result = await service.forgotPassword({
        email: 'TEST@example.com',
      });

      expect(verificationCodeService.send).toHaveBeenCalledWith(
        'test@example.com',
        'reset-password',
      );
      expect(result.message).toBe('auth.forgot_password_hint');
    });

    it('should return success message even if user does not exist', async () => {
      userService.findByEmail.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'noone@example.com',
      });

      expect(verificationCodeService.send).not.toHaveBeenCalled();
      expect(result.message).toBe('auth.forgot_password_hint');
    });
  });

  describe('resetPassword', () => {
    it('should verify code, hash new password, and logout all devices', async () => {
      verificationCodeService.verify.mockResolvedValue(true);
      userService.findByEmail.mockResolvedValue(mockUser);
      (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$reset');
      (prismaService.user.update as jest.Mock).mockResolvedValue(mockUser);
      (prismaService.userSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await service.resetPassword({
        email: 'TEST@example.com',
        code: '123456',
        password: 'NewPassword123!',
      });

      expect(verificationCodeService.verify).toHaveBeenCalledWith(
        'test@example.com',
        '123456',
        'reset-password',
      );
      expect(argon2.hash).toHaveBeenCalledWith(
        'NewPassword123!',
        expect.objectContaining({ type: argon2.argon2id }),
      );
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { passwordHash: '$argon2id$reset' },
      });
      expect(prismaService.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
      });
    });

    it('should throw NotFoundException if user not found after code verification', async () => {
      verificationCodeService.verify.mockResolvedValue(true);
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          email: 'ghost@example.com',
          code: '123456',
          password: 'NewPass!',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
