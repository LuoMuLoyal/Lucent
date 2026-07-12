import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ResultCode } from '../../../common/api';
import type { Request } from 'express';
import { LocalController } from './local.controller';
import { AuthService } from '../services/auth.service';
import { VerificationCodeService } from '../services/verification-code.service';

const mockRequest = {
  headers: { 'user-agent': 'test-agent' },
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
} as unknown as Request;

const mockAuthResult = {
  user: {
    id: 'user-1',
    email: 'test@example.com',
    nickname: 'TestUser',
    avatar: null,
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  },
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: '2026-07-11T00:00:00Z',
  refreshTokenExpiresAt: '2026-07-18T00:00:00Z',
};

describe('LocalController', () => {
  let controller: LocalController;
  let authService: vi.Mocked<AuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LocalController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: vi.fn(),
            login: vi.fn(),
            sendVerificationCode: vi.fn(),
            verifyEmail: vi.fn(),
            forgotPassword: vi.fn(),
            resetPassword: vi.fn(),
          },
        },
        {
          provide: VerificationCodeService,
          useValue: {
            getCooldownSec: vi.fn().mockReturnValue(60),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    controller = module.get(LocalController);
    authService = module.get(AuthService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /auth/register', () => {
    it('registers a user and returns auth response envelope', async () => {
      authService.register.mockResolvedValue(mockAuthResult as never);

      const result = await controller.register(
        {
          email: 'test@example.com',
          password: 'Password123!',
          nickname: 'TestUser',
        } as never,
        mockRequest,
      );

      expect(authService.register).toHaveBeenCalledWith(
        {
          email: 'test@example.com',
          password: 'Password123!',
          nickname: 'TestUser',
        },
        expect.objectContaining({ userAgent: 'test-agent' }),
      );
      expect(result.code).toBe(ResultCode.SUCCESS);
      expect(result.data).toHaveProperty('user');
      expect(result.data).toHaveProperty('tokens');
    });
  });

  describe('POST /auth/login', () => {
    it('logs in and returns auth response envelope', async () => {
      authService.login.mockResolvedValue(mockAuthResult as never);

      const result = await controller.login(
        { email: 'test@example.com', password: 'Password123!' },
        mockRequest,
      );

      expect(authService.login).toHaveBeenCalled();
      expect(result.code).toBe(ResultCode.SUCCESS);
      expect(result.data!.user.email).toBe('test@example.com');
    });
  });

  describe('POST /auth/send-verification-code', () => {
    it('returns cooldown and message envelope', async () => {
      authService.sendVerificationCode.mockResolvedValue({
        message: 'Code sent',
      } as never);

      const result = await controller.sendVerificationCode(
        { email: 'test@example.com', type: 'register' } as never,
        mockRequest,
      );

      expect(result.code).toBe(ResultCode.SUCCESS);
      expect(result.data).toHaveProperty('cooldown', 60);
      expect(result.data).toHaveProperty('message', 'Code sent');
    });
  });

  describe('POST /auth/verify-email', () => {
    it('returns emailVerified true', async () => {
      authService.verifyEmail.mockResolvedValue(undefined);

      const result = await controller.verifyEmail({
        email: 'test@example.com',
        code: '123456',
      });

      expect(authService.verifyEmail).toHaveBeenCalled();
      expect(result.data).toEqual({ emailVerified: true });
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('returns cooldown and message envelope', async () => {
      authService.forgotPassword.mockResolvedValue({
        message: 'Reset link sent',
      } as never);

      const result = await controller.forgotPassword(
        { email: 'test@example.com' },
        mockRequest,
      );

      expect(result.data).toHaveProperty('message', 'Reset link sent');
    });
  });

  describe('POST /auth/reset-password', () => {
    it('returns null data on success', async () => {
      authService.resetPassword.mockResolvedValue(undefined);

      const result = await controller.resetPassword({
        email: 'test@example.com',
        code: '123456',
        password: 'NewPassword123!',
      });

      expect(authService.resetPassword).toHaveBeenCalled();
      expect(result.data).toBeNull();
    });
  });
});
