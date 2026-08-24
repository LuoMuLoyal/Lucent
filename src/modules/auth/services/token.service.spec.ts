import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '#generated/prisma/client';
import { AuthTokenService } from './token.service';
import { normalizeEmail } from '../../../common';
import { PrismaService } from '../../../prisma';
import { AuthSessionRepositoryPort } from '../repositories/session.repository';
import { AuthBetterAuthAdapter } from '../adapters/better-auth.adapter';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function refreshTokenInvalid(): DomainFailure {
  return createDomainFailure({
    kind: 'authentication',
    code: 'AUTH_REFRESH_TOKEN_INVALID',
  });
}

function sessionNotFound(): DomainFailure {
  return createDomainFailure({
    kind: 'authentication',
    code: 'AUTH_SESSION_NOT_FOUND',
  });
}

/**
 * Folds a ResultAsync into a plain outcome so specs can assert both success
 * values and DomainFailure codes without throwing.
 */
function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('AuthTokenService', () => {
  let service: AuthTokenService;
  let sessionRepo: vi.Mocked<AuthSessionRepositoryPort>;
  let betterAuthAdapter: vi.Mocked<AuthBetterAuthAdapter>;
  let prisma: { $transaction: vi.Mock };

  const mockTx = {} as unknown as Prisma.TransactionClient;

  const mockUser: { id: string; email: string; status: string } = {
    id: 'user-1',
    email: 'test@example.com',
    status: 'active',
  };

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: Prisma.TransactionClient) => unknown) =>
          fn(mockTx),
        ),
    };

    const betterAuthAdapterMock = {
      revokeBetterAuthSessions: vi.fn().mockReturnValue(okAsync(undefined)),
    };

    const sessionRepoMock = {
      createSession: vi.fn().mockResolvedValue(undefined),
      findSessionByRefreshTokenHash: vi
        .fn()
        .mockReturnValue(errAsync(refreshTokenInvalid())),
      deleteSessionById: vi.fn().mockResolvedValue(undefined),
      claimSessionForRefresh: vi.fn().mockReturnValue(okAsync(undefined)),
      deleteSessionsByUserIdAndHash: vi
        .fn()
        .mockReturnValue(okAsync(undefined)),
      deleteSessionsByUserId: vi.fn().mockReturnValue(okAsync(undefined)),
      findSessionById: vi.fn().mockReturnValue(errAsync(sessionNotFound())),
      revokeSessionById: vi.fn().mockReturnValue(okAsync(undefined)),
      listActiveSessions: vi.fn().mockReturnValue(okAsync([])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthTokenService,
        {
          provide: AuthSessionRepositoryPort,
          useValue: sessionRepoMock,
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: vi.fn().mockResolvedValue('mock-access-token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: vi.fn().mockReturnValue({
              accessSecret: 'access-secret',
              refreshSecret: 'refresh-secret',
              accessTtl: 900,
              refreshTtl: 604800,
            }),
          },
        },
        {
          provide: AuthBetterAuthAdapter,
          useValue: betterAuthAdapterMock,
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get(AuthTokenService);
    sessionRepo = module.get(AuthSessionRepositoryPort);
    betterAuthAdapter = module.get(AuthBetterAuthAdapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateTokenPair', () => {
    it('should create a session and return tokens', async () => {
      const outcome = await collectResult(
        service.generateTokenPair(mockUser as never),
      );

      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({
          accessToken: 'mock-access-token',
          refreshToken: expect.any(String),
          accessTokenExpiresAt: expect.any(String),
          refreshTokenExpiresAt: expect.any(String),
        }),
      });
      expect(sessionRepo.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          refreshTokenHash: expect.any(String),
        }),
      );
    });

    it('should set IP and user-agent from context', async () => {
      await collectResult(
        service.generateTokenPair(mockUser as never, {
          ipAddress: '1.2.3.4',
          userAgent: 'TestAgent/1.0',
        }),
      );

      expect(sessionRepo.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { ipAddress: '1.2.3.4', userAgent: 'TestAgent/1.0' },
        }),
      );
    });

    it('should not set context property when context is undefined', async () => {
      await collectResult(service.generateTokenPair(mockUser as never));

      const callArg = (sessionRepo.createSession as vi.Mock).mock.calls[0]![0];
      expect(callArg.context).toBeUndefined();
    });

    it('should produce different refresh tokens across calls', async () => {
      const a = await collectResult(
        service.generateTokenPair(mockUser as never),
      );
      const b = await collectResult(
        service.generateTokenPair(mockUser as never),
      );
      expect(a).toEqual({ ok: true, value: expect.any(Object) });
      expect(b).toEqual({ ok: true, value: expect.any(Object) });
      if (a.ok && b.ok) {
        expect(a.value.refreshToken).not.toBe(b.value.refreshToken);
      }
    });

    it('maps signing failures to an INTERNAL_ERROR DomainFailure', async () => {
      const error = new Error('signing backend down');
      (service['jwtService'].signAsync as vi.Mock).mockRejectedValueOnce(error);

      const result = await collectResult(
        service.generateTokenPair(mockUser as never),
      );

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.cause).toBe(error);
    });
  });

  describe('refresh', () => {
    it('should rotate the refresh token', async () => {
      const oldToken = 'old-refresh-token';
      sessionRepo.findSessionByRefreshTokenHash.mockReturnValueOnce(
        okAsync({
          id: 'session-1',
          refreshTokenHash: hash(oldToken),
          expiresAt: new Date(Date.now() + 86400000),
          revokedAt: null,
          userId: 'user-1',
          user: mockUser as never,
        }),
      );

      const outcome = await collectResult(service.refresh(oldToken));

      expect(outcome).toEqual({
        ok: true,
        value: expect.objectContaining({ accessToken: 'mock-access-token' }),
      });
      expect(sessionRepo.claimSessionForRefresh).toHaveBeenCalledWith(
        'session-1',
      );
    });

    it('should fail when session was already claimed by a concurrent refresh', async () => {
      const oldToken = 'concurrent-refresh-token';
      sessionRepo.findSessionByRefreshTokenHash.mockReturnValueOnce(
        okAsync({
          id: 'session-2',
          refreshTokenHash: hash(oldToken),
          expiresAt: new Date(Date.now() + 86400000),
          revokedAt: null,
          userId: 'user-1',
          user: mockUser as never,
        }),
      );
      sessionRepo.claimSessionForRefresh.mockReturnValueOnce(
        errAsync(refreshTokenInvalid()),
      );

      const outcome = await collectResult(service.refresh(oldToken));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
        }),
      });
      expect(sessionRepo.claimSessionForRefresh).toHaveBeenCalledWith(
        'session-2',
      );
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        'Refresh token invalid',
        expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
          reason: 'already-claimed-or-expired',
          userId: 'user-1',
          refreshTokenHash: `${hash(oldToken).slice(0, 12)}…`,
        }),
      );
    });

    it('should fail for missing session', async () => {
      const outcome = await collectResult(service.refresh('unknown'));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
        }),
      });
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        'Refresh token invalid',
        expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
          reason: 'not-found',
          refreshTokenHash: `${hash('unknown').slice(0, 12)}…`,
        }),
      );
    });

    it('should fail for revoked session', async () => {
      sessionRepo.findSessionByRefreshTokenHash.mockReturnValueOnce(
        okAsync({
          id: 'session-1',
          refreshTokenHash: hash('revoked-token'),
          expiresAt: new Date(Date.now() + 86400000),
          revokedAt: new Date(),
          userId: 'user-1',
          user: mockUser as never,
        }),
      );

      const outcome = await collectResult(service.refresh('revoked-token'));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
        }),
      });
      expect(sessionRepo.claimSessionForRefresh).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        'Refresh token invalid',
        expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
          reason: 'revoked',
          userId: 'user-1',
          refreshTokenHash: `${hash('revoked-token').slice(0, 12)}…`,
        }),
      );
    });

    it('should fail for expired session', async () => {
      sessionRepo.findSessionByRefreshTokenHash.mockReturnValueOnce(
        okAsync({
          id: 'session-1',
          refreshTokenHash: hash('expired-token'),
          expiresAt: new Date(Date.now() - 1000),
          revokedAt: null,
          userId: 'user-1',
          user: mockUser as never,
        }),
      );

      const outcome = await collectResult(service.refresh('expired-token'));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
        }),
      });
      expect(sessionRepo.claimSessionForRefresh).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        'Refresh token invalid',
        expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
          reason: 'expired',
          userId: 'user-1',
          refreshTokenHash: `${hash('expired-token').slice(0, 12)}…`,
        }),
      );
    });

    it('should not mask repository failures as refresh-token-invalid', async () => {
      sessionRepo.findSessionByRefreshTokenHash.mockReturnValueOnce(
        okAsync({
          id: 'session-1',
          refreshTokenHash: hash('token'),
          expiresAt: new Date(Date.now() + 86400000),
          revokedAt: null,
          userId: 'user-1',
          user: mockUser as never,
        }),
      );
      // A rejecting ResultAsync (as produced by the repository when a
      // database/connection error is re-thrown) must surface as a rejection,
      // never as an AUTH_REFRESH_TOKEN_INVALID DomainFailure.
      sessionRepo.claimSessionForRefresh.mockReturnValueOnce(
        fromPromise(
          Promise.reject(new Error('db connection lost')),
          (error) => {
            throw error;
          },
        ),
      );

      await expect(collectResult(service.refresh('token'))).rejects.toThrow(
        'db connection lost',
      );
    });
  });

  describe('revoke', () => {
    it('should delete the session by refresh token hash and revoke Better Auth sessions', async () => {
      const outcome = await collectResult(
        service.revoke('user-1', 'some-token'),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(sessionRepo.deleteSessionsByUserIdAndHash).toHaveBeenCalledWith(
        'user-1',
        hash('some-token'),
        mockTx,
      );
      expect(betterAuthAdapter.revokeBetterAuthSessions).toHaveBeenCalledWith(
        'user-1',
        mockTx,
      );
    });

    it('should hash the token before deletion', async () => {
      await collectResult(service.revoke('user-1', 'another-token'));

      const expectedHash = hash('another-token');
      expect(sessionRepo.deleteSessionsByUserIdAndHash).toHaveBeenCalledWith(
        'user-1',
        expectedHash,
        mockTx,
      );
    });

    it('should not revoke Better Auth sessions when Lucent session deletion fails', async () => {
      sessionRepo.deleteSessionsByUserIdAndHash.mockReturnValueOnce(
        errAsync(refreshTokenInvalid()),
      );

      const outcome = await collectResult(
        service.revoke('user-1', 'some-token'),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_REFRESH_TOKEN_INVALID' }),
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(betterAuthAdapter.revokeBetterAuthSessions).not.toHaveBeenCalled();
    });
  });

  describe('revokeAll', () => {
    it('should delete all sessions for the user and revoke Better Auth sessions', async () => {
      const outcome = await collectResult(service.revokeAll('user-1'));

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(sessionRepo.deleteSessionsByUserId).toHaveBeenCalledWith(
        'user-1',
        mockTx,
      );
      expect(betterAuthAdapter.revokeBetterAuthSessions).toHaveBeenCalledWith(
        'user-1',
        mockTx,
      );
    });

    it('should not revoke Better Auth sessions when Lucent session deletion fails', async () => {
      sessionRepo.deleteSessionsByUserId.mockReturnValueOnce(
        errAsync(refreshTokenInvalid()),
      );

      const outcome = await collectResult(service.revokeAll('user-1'));

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_REFRESH_TOKEN_INVALID' }),
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(betterAuthAdapter.revokeBetterAuthSessions).not.toHaveBeenCalled();
    });
  });

  describe('revokeById', () => {
    it('should revoke a session by its ID and clean up Better Auth sessions', async () => {
      sessionRepo.findSessionById.mockReturnValueOnce(
        okAsync({
          id: 'session-1',
          userId: 'user-1',
        } as never),
      );

      const outcome = await collectResult(
        service.revokeById('user-1', 'session-1'),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(sessionRepo.revokeSessionById).toHaveBeenCalledWith('session-1');
      expect(betterAuthAdapter.revokeBetterAuthSessions).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('should map a missing session to AUTH_SESSION_NOT_FOUND', async () => {
      const outcome = await collectResult(
        service.revokeById('user-1', 'nonexistent'),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_SESSION_NOT_FOUND' }),
      });
      expect(sessionRepo.revokeSessionById).not.toHaveBeenCalled();
    });

    it('should map a foreign session to AUTH_SESSION_ACCESS_DENIED', async () => {
      sessionRepo.findSessionById.mockReturnValueOnce(
        okAsync({
          id: 'session-1',
          userId: 'user-2',
        } as never),
      );

      const outcome = await collectResult(
        service.revokeById('user-1', 'session-1'),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_SESSION_ACCESS_DENIED',
        }),
      });
      expect(sessionRepo.revokeSessionById).not.toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    it('should return only active sessions', async () => {
      const now = new Date();
      sessionRepo.listActiveSessions.mockReturnValueOnce(
        okAsync([
          {
            id: 'session-1',
            userId: 'user-1',
            deviceType: 'mobile',
            deviceName: 'iPhone 15',
            platform: 'ios',
            lastUsedAt: now,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 86400000),
          },
          {
            id: 'session-2',
            userId: 'user-1',
            deviceType: 'desktop',
            deviceName: null,
            platform: 'windows',
            lastUsedAt: new Date(now.getTime() - 3600000),
            createdAt: new Date(now.getTime() - 86400000),
            expiresAt: new Date(now.getTime() + 86400000),
          },
        ]),
      );

      const outcome = await collectResult(service.listSessions('user-1'));

      expect(outcome).toEqual({
        ok: true,
        value: expect.any(Array),
      });
      if (outcome.ok) {
        expect(outcome.value).toHaveLength(2);
        expect(outcome.value[0]?.id).toBe('session-1');
        expect(outcome.value[0]?.deviceType).toBe('mobile');
        expect(outcome.value[1]?.deviceName).toBeNull();
      }
      expect(sessionRepo.listActiveSessions).toHaveBeenCalledWith('user-1');
    });

    it('should return empty array when no active sessions', async () => {
      const outcome = await collectResult(service.listSessions('user-1'));

      expect(outcome).toEqual({ ok: true, value: [] });
    });
  });

  describe('hashRefreshToken', () => {
    it('should return SHA-256 hex digest', () => {
      const result = service.hashRefreshToken('test-token');
      expect(result).toBe(hash('test-token'));
    });

    it('should return different hashes for different tokens', () => {
      const a = service.hashRefreshToken('token-a');
      const b = service.hashRefreshToken('token-b');
      expect(a).not.toBe(b);
    });

    it('should return a 64-character hex string', () => {
      const result = service.hashRefreshToken('any-token');
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce consistent hash for the same input', () => {
      const a = service.hashRefreshToken('same-token');
      const b = service.hashRefreshToken('same-token');
      expect(a).toBe(b);
    });
  });

  describe('normalizeEmail (shared helper)', () => {
    it('should trim and lowercase', () => {
      expect(normalizeEmail('  Test@Example.COM  ')).toBe('test@example.com');
    });
  });
});
