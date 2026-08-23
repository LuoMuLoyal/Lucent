import { Test, type TestingModule } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { LocalController } from './local.controller';
import { AuthService } from '../services/auth.service';
import { VerificationCodeService } from '../services/identity/verification-code.service';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
} from '../../../common/result';

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
      authService.register.mockReturnValue(okAsync(mockAuthResult as never));

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

    it('folds credential failures into DomainFailureException', async () => {
      authService.register.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_WRONG_PASSWORD',
          }),
        ),
      );

      await expect(
        controller.register(
          {
            email: 'taken@example.com',
            password: 'Password123!',
            code: '123456',
          } as never,
          mockRequest,
        ),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: { code: 'AUTH_WRONG_PASSWORD' },
      });
    });

    it('does not swallow infrastructure failures', async () => {
      authService.register.mockImplementation(() =>
        fromPromise(
          Promise.reject(new Error('db connection lost')),
          (error) => {
            throw error;
          },
        ),
      );

      await expect(
        controller.register(
          { email: 'test@example.com', password: 'Password123!' } as never,
          mockRequest,
        ),
      ).rejects.toThrow('db connection lost');
    });
  });

  describe('POST /auth/login', () => {
    it('logs in and returns an auth resource', async () => {
      authService.login.mockReturnValue(okAsync(mockAuthResult as never));

      const result = await controller.login(
        { email: 'test@example.com', password: 'Password123!' },
        mockRequest,
      );

      expect(authService.login).toHaveBeenCalled();
      expect(result.user.email).toBe('test@example.com');
    });

    it('folds login failures into DomainFailureException with the generic code', async () => {
      authService.login.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_WRONG_PASSWORD',
          }),
        ),
      );

      await expect(
        controller.login(
          { email: 'test@example.com', password: 'WrongPass1' },
          mockRequest,
        ),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: { code: 'AUTH_WRONG_PASSWORD' },
      });
    });
  });

  describe('POST /auth/send-verification-code', () => {
    it('returns cooldown and message resource', async () => {
      authService.sendVerificationCode.mockReturnValue(
        okAsync({ message: 'Code sent' } as never),
      );

      const result = await controller.sendVerificationCode(
        { email: 'test@example.com', type: 'register' } as never,
        mockRequest,
      );

      expect(result).toHaveProperty('cooldown', 60);
      expect(result).toHaveProperty('message', 'Code sent');
    });

    it('folds cooldown failures into DomainFailureException', async () => {
      authService.sendVerificationCode.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'rate_limited',
            code: 'AUTH_VERIFICATION_CODE_COOLDOWN',
            retryable: true,
            retryAfter: 60,
          }),
        ),
      );

      await expect(
        controller.sendVerificationCode(
          { email: 'test@example.com', type: 'register' } as never,
          mockRequest,
        ),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: { code: 'AUTH_VERIFICATION_CODE_COOLDOWN' },
      });
    });
  });

  describe('POST /auth/verify-email', () => {
    it('returns emailVerified true', async () => {
      authService.verifyEmail.mockReturnValue(okAsync(undefined));

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
      authService.forgotPassword.mockReturnValue(
        okAsync({ message: 'Reset link sent' } as never),
      );

      const result = await controller.forgotPassword(
        { email: 'test@example.com' },
        mockRequest,
      );

      expect(result).toHaveProperty('message', 'Reset link sent');
    });
  });

  describe('POST /auth/reset-password', () => {
    it('returns no content on success', async () => {
      authService.resetPassword.mockReturnValue(okAsync(undefined));

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
