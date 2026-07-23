import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { I18nService } from 'nestjs-i18n';
import { AuthTokenService } from './token.service';
import { normalizeEmail } from '../../../common/helpers';
import { AuthSessionRepositoryPort } from '../repositories/session.repository';

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('AuthTokenService', () => {
  let service: AuthTokenService;
  let sessionRepo: vi.Mocked<AuthSessionRepositoryPort>;

  const mockUser: { id: string; email: string; status: string } = {
    id: 'user-1',
    email: 'test@example.com',
    status: 'active',
  };

  beforeEach(async () => {
    const sessionRepoMock = {
      createSession: vi.fn().mockResolvedValue(undefined),
      findSessionByRefreshTokenHash: vi.fn().mockResolvedValue(null),
      deleteSessionById: vi.fn().mockResolvedValue(undefined),
      claimSessionForRefresh: vi.fn().mockResolvedValue(true),
      deleteSessionsByUserIdAndHash: vi.fn().mockResolvedValue(undefined),
      deleteSessionsByUserId: vi.fn().mockResolvedValue(undefined),
      findSessionById: vi.fn().mockResolvedValue(null),
      revokeSessionById: vi.fn().mockResolvedValue(undefined),
      listActiveSessions: vi.fn().mockResolvedValue([]),
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
          provide: I18nService,
          useValue: {
            t: vi.fn((key: string) => key),
          },
        },
      ],
    }).compile();

    service = module.get(AuthTokenService);
    sessionRepo = module.get(AuthSessionRepositoryPort);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateTokenPair', () => {
    it('should create a session and return tokens', async () => {
      const result = await service.generateTokenPair(mockUser as never);

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(result.accessTokenExpiresAt).toEqual(expect.any(String));
      expect(result.refreshTokenExpiresAt).toEqual(expect.any(String));
      expect(sessionRepo.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          refreshTokenHash: expect.any(String),
        }),
      );
    });

    it('should set IP and user-agent from context', async () => {
      await service.generateTokenPair(mockUser as never, {
        ipAddress: '1.2.3.4',
        userAgent: 'TestAgent/1.0',
      });

      expect(sessionRepo.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { ipAddress: '1.2.3.4', userAgent: 'TestAgent/1.0' },
        }),
      );
    });

    it('should not set context property when context is undefined', async () => {
      await service.generateTokenPair(mockUser as never);

      const callArg = (sessionRepo.createSession as vi.Mock).mock.calls[0]![0];
      expect(callArg.context).toBeUndefined();
    });

    it('should produce different refresh tokens across calls', async () => {
      const a = await service.generateTokenPair(mockUser as never);
      const b = await service.generateTokenPair(mockUser as never);
      expect(a.refreshToken).not.toBe(b.refreshToken);
    });
  });

  describe('refresh', () => {
    it('should rotate the refresh token', async () => {
      const oldToken = 'old-refresh-token';
      sessionRepo.findSessionByRefreshTokenHash.mockResolvedValueOnce({
        id: 'session-1',
        refreshTokenHash: hash(oldToken),
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        userId: 'user-1',
        user: mockUser as never,
      });
      sessionRepo.claimSessionForRefresh.mockResolvedValueOnce(true);

      const result = await service.refresh(oldToken);

      expect(result.accessToken).toBe('mock-access-token');
      expect(sessionRepo.claimSessionForRefresh).toHaveBeenCalledWith(
        'session-1',
      );
    });

    it('should throw when session was already claimed by a concurrent refresh', async () => {
      const oldToken = 'concurrent-refresh-token';
      sessionRepo.findSessionByRefreshTokenHash.mockResolvedValueOnce({
        id: 'session-2',
        refreshTokenHash: hash(oldToken),
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        userId: 'user-1',
        user: mockUser as never,
      });
      sessionRepo.claimSessionForRefresh.mockResolvedValueOnce(false);

      await expect(service.refresh(oldToken)).rejects.toThrow(
        'REFRESH_TOKEN_INVALID',
      );
      expect(sessionRepo.claimSessionForRefresh).toHaveBeenCalledWith(
        'session-2',
      );
    });

    it('should throw for missing session', async () => {
      await expect(service.refresh('unknown')).rejects.toThrow(
        'REFRESH_TOKEN_INVALID',
      );
    });

    it('should throw for revoked session', async () => {
      sessionRepo.findSessionByRefreshTokenHash.mockResolvedValueOnce({
        id: 'session-1',
        refreshTokenHash: hash('revoked-token'),
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(),
        userId: 'user-1',
        user: mockUser as never,
      });

      await expect(service.refresh('revoked-token')).rejects.toThrow(
        'REFRESH_TOKEN_INVALID',
      );
    });

    it('should throw for expired session', async () => {
      sessionRepo.findSessionByRefreshTokenHash.mockResolvedValueOnce({
        id: 'session-1',
        refreshTokenHash: hash('expired-token'),
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
        userId: 'user-1',
        user: mockUser as never,
      });

      await expect(service.refresh('expired-token')).rejects.toThrow(
        'REFRESH_TOKEN_INVALID',
      );
    });
  });

  describe('revoke', () => {
    it('should delete the session by refresh token hash', async () => {
      await service.revoke('user-1', 'some-token');

      expect(sessionRepo.deleteSessionsByUserIdAndHash).toHaveBeenCalledWith(
        'user-1',
        hash('some-token'),
      );
    });

    it('should hash the token before deletion', async () => {
      await service.revoke('user-1', 'another-token');

      const expectedHash = hash('another-token');
      expect(sessionRepo.deleteSessionsByUserIdAndHash).toHaveBeenCalledWith(
        'user-1',
        expectedHash,
      );
    });
  });

  describe('revokeAll', () => {
    it('should delete all sessions for the user', async () => {
      await service.revokeAll('user-1');

      expect(sessionRepo.deleteSessionsByUserId).toHaveBeenCalledWith('user-1');
    });
  });

  describe('revokeById', () => {
    it('should revoke a session by its ID', async () => {
      sessionRepo.findSessionById.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
      } as never);

      await service.revokeById('user-1', 'session-1');

      expect(sessionRepo.revokeSessionById).toHaveBeenCalledWith('session-1');
    });

    it('should throw NotFoundException when session is not found', async () => {
      await expect(service.revokeById('user-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when session belongs to another user', async () => {
      sessionRepo.findSessionById.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-2',
      } as never);

      await expect(service.revokeById('user-1', 'session-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('listSessions', () => {
    it('should return only active sessions', async () => {
      const now = new Date();
      sessionRepo.listActiveSessions.mockResolvedValueOnce([
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
      ]);

      const result = await service.listSessions('user-1');

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('session-1');
      expect(result[0]?.deviceType).toBe('mobile');
      expect(result[1]?.deviceName).toBeNull();
      expect(sessionRepo.listActiveSessions).toHaveBeenCalledWith('user-1');
    });

    it('should return empty array when no active sessions', async () => {
      const result = await service.listSessions('user-1');
      expect(result).toHaveLength(0);
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
