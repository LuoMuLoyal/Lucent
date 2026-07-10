/* eslint-disable @typescript-eslint/no-unsafe-call */
import { AuthSessionRepository } from './session.repository';
import type { PrismaService } from '../../../prisma/prisma.service';

describe('AuthSessionRepository', () => {
  let repository: AuthSessionRepository;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      userSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

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

      const result = await repository.findSessionByRefreshTokenHash('hash');

      expect(result).toBe(mockSession);
      expect(prisma.userSession.findUnique).toHaveBeenCalledWith({
        where: { refreshTokenHash: 'hash' },
        include: { user: true },
      });
    });

    it('returns null when session not found', async () => {
      prisma.userSession.findUnique.mockResolvedValue(null);

      const result = await repository.findSessionByRefreshTokenHash('missing');
      expect(result).toBeNull();
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

  describe('deleteSessionsByUserIdAndHash', () => {
    it('deletes many by userId and hash', async () => {
      prisma.userSession.deleteMany.mockResolvedValue({ count: 2 } as never);

      await repository.deleteSessionsByUserIdAndHash('user-1', 'hash');

      expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', refreshTokenHash: 'hash' },
      });
    });
  });

  describe('deleteSessionsByUserId', () => {
    it('deletes all sessions for a user', async () => {
      prisma.userSession.deleteMany.mockResolvedValue({ count: 5 } as never);

      await repository.deleteSessionsByUserId('user-1');

      expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });

  describe('findSessionById', () => {
    it('queries by id', async () => {
      const mockSession = { id: 's1' };
      prisma.userSession.findUnique.mockResolvedValue(mockSession as never);

      const result = await repository.findSessionById('s1');

      expect(result).toBe(mockSession);
      expect(prisma.userSession.findUnique).toHaveBeenCalledWith({
        where: { id: 's1' },
      });
    });
  });

  describe('revokeSessionById', () => {
    it('updates revokedAt to current time', async () => {
      prisma.userSession.update.mockResolvedValue(undefined as never);

      await repository.revokeSessionById('session-1');

      expect(prisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('listActiveSessions', () => {
    it('queries active, non-expired sessions for user', async () => {
      const mockSessions = [
        { id: 's1', userId: 'user-1', deviceType: 'mobile' },
      ];
      prisma.userSession.findMany.mockResolvedValue(mockSessions as never);

      const result = await repository.listActiveSessions('user-1');

      expect(result).toBe(mockSessions);
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

      await repository.listActiveSessions('user-1');

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
  });
});
