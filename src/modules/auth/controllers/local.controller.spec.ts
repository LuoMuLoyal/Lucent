import { Test, type TestingModule } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { LocalController } from './local.controller';
import { AuthService } from '../services/auth.service';
import { VerificationCodeService } from '../services/identity/verification-code.service';

const mockRequest = {
  headers: { 'user-agent': 'test-agent' },
  ip: '127.0.0.1',
  raw: { socket: { remoteAddress: '127.0.0.1' } },
} as unknown as FastifyRequest;

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
      ],
    }).compile();

    controller = module.get(LocalController);
    authService = module.get(AuthService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /auth/register', () => {
    it('registers a user and returns an auth resource', async () => {
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
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
    });
  });

  describe('POST /auth/login', () => {
    it('logs in and returns an auth resource', async () => {
      authService.login.mockResolvedValue(mockAuthResult as never);

      const result = await controller.login(
        { email: 'test@example.com', password: 'Password123!' },
        mockRequest,
      );

      expect(authService.login).toHaveBeenCalled();
      expect(result.user.email).toBe('test@example.com');
    });
  });

  describe('POST /auth/send-verification-code', () => {
    it('returns cooldown and message resource', async () => {
      authService.sendVerificationCode.mockResolvedValue({
        message: 'Code sent',
      } as never);

      const result = await controller.sendVerificationCode(
        { email: 'test@example.com', type: 'register' } as never,
        mockRequest,
      );

      expect(result).toHaveProperty('cooldown', 60);
      expect(result).toHaveProperty('message', 'Code sent');
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
      expect(result).toEqual({ emailVerified: true });
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('returns cooldown and message resource', async () => {
      authService.forgotPassword.mockResolvedValue({
        message: 'Reset link sent',
      } as never);

      const result = await controller.forgotPassword(
        { email: 'test@example.com' },
        mockRequest,
      );

      expect(result).toHaveProperty('message', 'Reset link sent');
    });
  });

  describe('POST /auth/reset-password', () => {
    it('returns no content on success', async () => {
      authService.resetPassword.mockResolvedValue(undefined);

      await expect(
        controller.resetPassword({
          email: 'test@example.com',
          code: '123456',
          password: 'NewPassword123!',
        }),
      ).resolves.toBeUndefined();

      expect(authService.resetPassword).toHaveBeenCalled();
    });
  });
});
