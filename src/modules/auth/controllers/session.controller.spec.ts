import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../../common/api';
import type { Request } from 'express';
import { SessionController } from './session.controller';
import { AuthService } from '../services/auth.service';
import { AuthTokenService } from '../services/token.service';
import type { UserPayload } from '../types/auth-request';

const mockUser: UserPayload = {
  sub: 'user-1',
  email: 'test@example.com',
  status: 'active',
};

const mockRequest = {
  headers: { 'user-agent': 'test-agent' },
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
} as unknown as Request;

const mockRefreshResult = {
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  accessTokenExpiresAt: '2026-07-11T01:00:00Z',
  refreshTokenExpiresAt: '2026-07-18T01:00:00Z',
};

describe('SessionController', () => {
  let controller: SessionController;
  let authService: vi.Mocked<AuthService>;
  let authTokenService: vi.Mocked<AuthTokenService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            logout: vi.fn().mockResolvedValue(undefined),
            refresh: vi.fn().mockResolvedValue(mockRefreshResult),
          },
        },
        {
          provide: AuthTokenService,
          useValue: {
            listSessions: vi.fn(),
            revokeById: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get(SessionController);
    authService = module.get(AuthService);
    authTokenService = module.get(AuthTokenService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /auth/logout', () => {
    it('logs out and returns null envelope', async () => {
      const result = await controller.logout(mockUser, {
        refreshToken: 'refresh-token',
      });

      expect(authService.logout).toHaveBeenCalledWith(
        'user-1',
        'refresh-token',
      );
      expect(result.code).toBe(ResultCode.SUCCESS);
      expect(result.data).toBeNull();
    });
  });

  describe('GET /auth/sessions', () => {
    it('returns sessions list envelope', async () => {
      const sessions = [
        {
          id: 'sess-1',
          ipAddress: '127.0.0.1',
          userAgent: 'test',
          createdAt: '2026-07-10T00:00:00Z',
        },
      ];
      authTokenService.listSessions.mockResolvedValue(sessions as never);

      const result = await controller.listSessions(mockUser);

      expect(authTokenService.listSessions).toHaveBeenCalledWith('user-1');
      expect(result.data).toEqual(sessions);
    });
  });

  describe('DELETE /auth/sessions/:sessionId', () => {
    it('revokes session and returns null envelope', async () => {
      const result = await controller.revokeSession(mockUser, 'sess-1');

      expect(authTokenService.revokeById).toHaveBeenCalledWith(
        'user-1',
        'sess-1',
      );
      expect(result.data).toBeNull();
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns new tokens envelope', async () => {
      const result = await controller.refresh(
        { refreshToken: 'old-refresh' },
        mockRequest,
      );

      expect(authService.refresh).toHaveBeenCalledWith(
        'old-refresh',
        expect.objectContaining({ userAgent: 'test-agent' }),
      );
      expect(result.code).toBe(ResultCode.SUCCESS);
      expect(result.data).toHaveProperty('accessToken', 'new-access');
      expect(result.data).toHaveProperty('refreshToken', 'new-refresh');
      expect(result.data).toHaveProperty('expiresIn');
    });
  });
});
