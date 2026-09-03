import { Test, type TestingModule } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { SessionController } from './session.controller.js';
import { AuthService } from '../services/auth.service.js';
import { AuthTokenService } from '../services/token.service.js';
import { AuditLogService } from '../../audit-log/index.js';
import { DomainFailureException } from '../../../common/result/unwrap-result.js';
import {
  createDomainFailure,
  errAsync,
  okAsync,
} from '../../../common/result/index.js';
import type { UserPayload } from '../types/auth-request.js';

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
  let auditLogService: vi.Mocked<AuditLogService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            logout: vi.fn().mockReturnValue(okAsync(undefined)),
            refresh: vi.fn().mockReturnValue(okAsync(mockRefreshResult)),
          },
        },
        {
          provide: AuthTokenService,
          useValue: {
            listSessions: vi.fn().mockReturnValue(okAsync([])),
            revokeById: vi.fn().mockReturnValue(okAsync(undefined)),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            logFireAndForget: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(SessionController);
    authService = module.get(AuthService);
    authTokenService = module.get(AuthTokenService);
    auditLogService = module.get(AuditLogService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /auth/logout', () => {
    it('logs out and returns no content (204)', async () => {
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

    it('rethrows DomainFailureException when logout fails (401 path)', async () => {
      authService.logout.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_REQUIRED',
          }),
        ),
      );

      await expect(
        controller.logout(mockUser, { refreshToken: 'refresh-token' }),
      ).rejects.toBeInstanceOf(DomainFailureException);
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
      authTokenService.listSessions.mockReturnValue(okAsync(sessions as never));

      const result = await controller.listSessions(mockUser);

      expect(authTokenService.listSessions).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(sessions);
    });
  });

  describe('DELETE /auth/sessions/:sessionId', () => {
    it('revokes session, writes audit log, and returns no content (204)', async () => {
      await expect(
        controller.revokeSession(mockUser, 'sess-1', mockRequest),
      ).resolves.toBeUndefined();

      expect(authTokenService.revokeById).toHaveBeenCalledWith(
        'user-1',
        'sess-1',
      );
      expect(auditLogService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          action: 'session.revoke',
          resourceType: 'session',
          resourceId: 'sess-1',
        }),
      );
    });

    it('does not write audit log when revocation fails (403 path)', async () => {
      authTokenService.revokeById.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authorization',
            code: 'AUTH_SESSION_ACCESS_DENIED',
          }),
        ),
      );

      await expect(
        controller.revokeSession(mockUser, 'sess-1', mockRequest),
      ).rejects.toBeInstanceOf(DomainFailureException);
      expect(auditLogService.logFireAndForget).not.toHaveBeenCalled();
    });

    it('rethrows DomainFailureException for a missing session (404 path)', async () => {
      authTokenService.revokeById.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_SESSION_NOT_FOUND',
          }),
        ),
      );

      await expect(
        controller.revokeSession(mockUser, 'missing', mockRequest),
      ).rejects.toBeInstanceOf(DomainFailureException);
      expect(auditLogService.logFireAndForget).not.toHaveBeenCalled();
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

    it('rethrows DomainFailureException for an invalid refresh token (401 path)', async () => {
      authService.refresh.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_REFRESH_TOKEN_INVALID',
          }),
        ),
      );

      await expect(
        controller.refresh({ refreshToken: 'bad-refresh' }, mockRequest),
      ).rejects.toBeInstanceOf(DomainFailureException);
    });
  });
});
