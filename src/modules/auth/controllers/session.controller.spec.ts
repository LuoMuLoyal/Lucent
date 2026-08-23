import { Test, type TestingModule } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { SessionController } from './session.controller';
import { AuthService } from '../services/auth.service';
import { AuthTokenService } from '../services/token.service';
import { okAsync } from '../../../common/result';
import type { UserPayload } from '../types/auth-request';

const mockUser: UserPayload = {
  sub: 'user-1',
  email: 'test@example.com',
  status: 'active',
};

const mockRequest = {
  headers: { 'user-agent': 'test-agent' },
  ip: '127.0.0.1',
  raw: { socket: { remoteAddress: '127.0.0.1' } },
} as unknown as FastifyRequest;

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
            refresh: vi.fn().mockReturnValue(okAsync(mockRefreshResult)),
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
    it('logs out and returns no content', async () => {
      await expect(
        controller.logout(mockUser, {
          refreshToken: 'refresh-token',
        }),
      ).resolves.toBeUndefined();

      expect(authService.logout).toHaveBeenCalledWith(
        'user-1',
        'refresh-token',
      );
    });
  });

  describe('GET /auth/sessions', () => {
    it('returns sessions list resource', async () => {
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
      expect(result).toEqual(sessions);
    });
  });

  describe('DELETE /auth/sessions/:sessionId', () => {
    it('revokes session and returns no content', async () => {
      await expect(
        controller.revokeSession(mockUser, 'sess-1', 'en'),
      ).resolves.toBeUndefined();

      expect(authTokenService.revokeById).toHaveBeenCalledWith(
        'user-1',
        'sess-1',
        'en',
      );
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns new tokens resource', async () => {
      const result = await controller.refresh(
        { refreshToken: 'old-refresh' },
        mockRequest,
      );

      expect(authService.refresh).toHaveBeenCalledWith(
        'old-refresh',
        expect.objectContaining({ userAgent: 'test-agent' }),
      );
      expect(result).toHaveProperty('accessToken', 'new-access');
      expect(result).toHaveProperty('refreshToken', 'new-refresh');
      expect(result).toHaveProperty('expiresIn');
    });
  });
});
