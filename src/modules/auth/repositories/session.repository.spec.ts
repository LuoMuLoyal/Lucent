import type { DeepMocked } from '../../../common/types/deep-mocked';
import type { DomainFailure, ResultAsync } from '../../../common/result';

import { AuthSessionRepository } from './session.repository';
import type { PrismaService } from '../../../prisma';

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

describe('AuthSessionRepository', () => {
  let repository: AuthSessionRepository;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      userSession: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as DeepMocked<PrismaService>;

    repository = new AuthSessionRepository(prisma);
  });

  describe('createSession', () => {
    it('creates a session with required fields', async () => {
      prisma.userSession.create.mockResolvedValue(undefined as never);

      await repository.createSession({
        userId: 'user-1',
        refreshTokenHash: 'hash-123',
        expiresAt: new Date('2026-07-11T00:00:00.000Z'),
        lastUsedAt: new Date('2026-07-10T12:00:00.000Z'),
      });

      expect(prisma.userSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          refreshTokenHash: 'hash-123',
          user: { connect: { id: 'user-1' } },
        }),
      });
    });

    it('includes ipAddress when provided in context', async () => {
      prisma.userSession.create.mockResolvedValue(undefined as never);

      await repository.createSession({
        userId: 'user-1',
        refreshTokenHash: 'hash',
        expiresAt: new Date(),
        lastUsedAt: new Date(),
        context: { ipAddress: '10.0.0.1' },
      });

      const call = prisma.userSession.create.mock.calls[0]?.[0];
      expect(call?.data).toHaveProperty('ipAddress', '10.0.0.1');
    });

    it('includes userAgent when provided in context', async () => {
      prisma.userSession.create.mockResolvedValue(undefined as never);

      await repository.createSession({
        userId: 'user-1',
        refreshTokenHash: 'hash',
        expiresAt: new Date(),
        lastUsedAt: new Date(),
        context: { userAgent: 'Mozilla/5.0' },
      });

      const call = prisma.userSession.create.mock.calls[0]?.[0];
      expect(call?.data).toHaveProperty('userAgent', 'Mozilla/5.0');
    });

    it('omits ipAddress and userAgent when context is undefined', async () => {
      prisma.userSession.create.mockResolvedValue(undefined as never);

      await repository.createSession({
        userId: 'user-1',
        refreshTokenHash: 'hash',
        expiresAt: new Date(),
        lastUsedAt: new Date(),
      });

      const call = prisma.userSession.create.mock.calls[0]?.[0];
      expect(call?.data).not.toHaveProperty('ipAddress');
      expect(call?.data).not.toHaveProperty('userAgent');
    });
  });

  describe('findSessionByRefreshTokenHash', () => {
    it('queries by refreshTokenHash with user include', async () => {
      const mockSession = { id: 's1', user: { id: 'user-1' } };
      prisma.userSession.findUnique.mockResolvedValue(mockSession as never);

      const outcome = await collectResult(
        repository.findSessionByRefreshTokenHash('hash'),
      );

      expect(outcome).toEqual({ ok: true, value: mockSession });
      expect(prisma.userSession.findUnique).toHaveBeenCalledWith({
        where: { refreshTokenHash: 'hash' },
        include: { user: true },
      });
    });

    it('maps a missing session to AUTH_REFRESH_TOKEN_INVALID', async () => {
      prisma.userSession.findUnique.mockResolvedValue(null);

      const outcome = await collectResult(
        repository.findSessionByRefreshTokenHash('missing'),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
        }),
      });
    });

    it('rethrows unknown database errors instead of mapping them', async () => {
      prisma.userSession.findUnique.mockRejectedValue(
        new Error('db connection lost'),
      );

      await expect(
        collectResult(repository.findSessionByRefreshTokenHash('hash')),
      ).rejects.toThrow('db connection lost');
    });
  });

  describe('deleteSessionById', () => {
    it('deletes by id', async () => {
      prisma.userSession.delete.mockResolvedValue(undefined as never);

      await repository.deleteSessionById('session-1');

      expect(prisma.userSession.delete).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
    });
  });

  describe('claimSessionForRefresh', () => {
    it('resolves ok when session is successfully claimed', async () => {
      prisma.userSession.deleteMany.mockResolvedValue({ count: 1 } as never);

      const outcome = await collectResult(
        repository.claimSessionForRefresh('session-1'),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: {
          id: 'session-1',
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it('maps an already-claimed session to AUTH_REFRESH_TOKEN_INVALID', async () => {
      prisma.userSession.deleteMany.mockResolvedValue({ count: 0 } as never);

      const outcome = await collectResult(
        repository.claimSessionForRefresh('session-1'),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: 'AUTH_REFRESH_TOKEN_INVALID',
        }),
      });
    });

    it('rethrows unknown database errors instead of mapping them', async () => {
      prisma.userSession.deleteMany.mockRejectedValue(
        new Error('db connection lost'),
      );

      await expect(
        collectResult(repository.claimSessionForRefresh('session-1')),
      ).rejects.toThrow('db connection lost');
    });
  });

  describe('deleteSessionsByUserIdAndHash', () => {
    it('deletes many by userId and hash', async () => {
      prisma.userSession.deleteMany.mockResolvedValue({ count: 2 } as never);

      const outcome = await collectResult(
        repository.deleteSessionsByUserIdAndHash('user-1', 'hash'),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', refreshTokenHash: 'hash' },
      });
    });
  });

  describe('deleteSessionsByUserId', () => {
    it('deletes all sessions for a user', async () => {
      prisma.userSession.deleteMany.mockResolvedValue({ count: 5 } as never);

      const outcome = await collectResult(
        repository.deleteSessionsByUserId('user-1'),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });

  describe('findSessionById', () => {
    it('queries by id', async () => {
      const mockSession = { id: 's1' };
      prisma.userSession.findUnique.mockResolvedValue(mockSession as never);

      const outcome = await collectResult(repository.findSessionById('s1'));

      expect(outcome).toEqual({ ok: true, value: mockSession });
      expect(prisma.userSession.findUnique).toHaveBeenCalledWith({
        where: { id: 's1' },
      });
    });

    it('maps a missing session to AUTH_SESSION_NOT_FOUND', async () => {
      prisma.userSession.findUnique.mockResolvedValue(null);

      const outcome = await collectResult(
        repository.findSessionById('missing'),
      );

      expect(outcome).toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_SESSION_NOT_FOUND' }),
      });
    });
  });

  describe('revokeSessionById', () => {
    it('updates revokedAt to current time', async () => {
      prisma.userSession.update.mockResolvedValue(undefined as never);

      const outcome = await collectResult(
        repository.revokeSessionById('session-1'),
      );

      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(prisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rethrows unknown database errors instead of mapping them', async () => {
      prisma.userSession.update.mockRejectedValue(
        new Error('db connection lost'),
      );

      await expect(
        collectResult(repository.revokeSessionById('session-1')),
      ).rejects.toThrow('db connection lost');
    });
  });

  describe('listActiveSessions', () => {
    it('queries active, non-expired sessions for user', async () => {
      const mockSessions = [
        { id: 's1', userId: 'user-1', deviceType: 'mobile' },
      ];
      prisma.userSession.findMany.mockResolvedValue(mockSessions as never);

      const outcome = await collectResult(
        repository.listActiveSessions('user-1'),
      );

      expect(outcome).toEqual({ ok: true, value: mockSessions });
      const call = prisma.userSession.findMany.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({
        userId: 'user-1',
        revokedAt: null,
      });
      expect(call?.where.expiresAt).toHaveProperty('gt');
      expect(call?.orderBy).toEqual({ lastUsedAt: 'desc' });
    });

    it('selects the correct fields', async () => {
      prisma.userSession.findMany.mockResolvedValue([] as never);

      await collectResult(repository.listActiveSessions('user-1'));

      const call = prisma.userSession.findMany.mock.calls[0]?.[0];
      expect(call?.select).toEqual({
        id: true,
        userId: true,
        deviceType: true,
        deviceName: true,
        platform: true,
        lastUsedAt: true,
        createdAt: true,
        expiresAt: true,
      });
    });

    it('resolves empty array when user has no active sessions', async () => {
      prisma.userSession.findMany.mockResolvedValue([] as never);

      const outcome = await collectResult(
        repository.listActiveSessions('user-1'),
      );

      expect(outcome).toEqual({ ok: true, value: [] });
    });
  });
});
