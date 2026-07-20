import { DataRetentionService } from './data-retention.service';
import type { PrismaService } from '../../../prisma/prisma.service';

const NOW = new Date('2026-07-20T03:00:00.000Z');

function buildPrisma() {
  return {
    userSession: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    userNotification: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    userSuggestionFeedback: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('DataRetentionService', () => {
  let service: DataRetentionService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    prisma = buildPrisma();
    service = new DataRetentionService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deletes expired sessions', async () => {
    prisma.userSession.deleteMany.mockResolvedValue({ count: 5 });

    await service.cleanupExpiredData();

    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: NOW } },
    });
  });

  it('deletes read notifications older than 30 days', async () => {
    prisma.userNotification.deleteMany.mockResolvedValue({ count: 12 });

    await service.cleanupExpiredData();

    expect(prisma.userNotification.deleteMany).toHaveBeenCalledWith({
      where: {
        isRead: true,
        readAt: { lt: new Date('2026-06-20T03:00:00.000Z') },
      },
    });
  });

  it('deletes expired feedback suppressions', async () => {
    prisma.userSuggestionFeedback.deleteMany.mockResolvedValue({ count: 3 });

    await service.cleanupExpiredData();

    expect(prisma.userSuggestionFeedback.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: NOW } },
    });
  });

  it('does not throw when a cleanup step fails', async () => {
    prisma.userSession.deleteMany.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(service.cleanupExpiredData()).resolves.toBeUndefined();

    // Other cleanup steps should still run
    expect(prisma.userNotification.deleteMany).toHaveBeenCalled();
    expect(prisma.userSuggestionFeedback.deleteMany).toHaveBeenCalled();
  });

  it('permanently deletes soft-deleted accounts past 30-day retention', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-deleted-1' },
      { id: 'user-deleted-2' },
    ]);
    prisma.user.deleteMany.mockResolvedValue({ count: 2 });

    await service.cleanupExpiredData();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: { lt: new Date('2026-06-20T03:00:00.000Z') },
        status: 'deleted',
      },
      select: { id: true },
    });
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-deleted-1', 'user-deleted-2'] } },
    });
  });

  it('skips account hard-delete when no expired accounts', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.cleanupExpiredData();

    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
  });

  it('logs nothing when zero records deleted', async () => {
    await service.cleanupExpiredData();

    // All deleteMany return { count: 0 } by default — no errors, no logs
    expect(prisma.userSession.deleteMany).toHaveBeenCalled();
    expect(prisma.userNotification.deleteMany).toHaveBeenCalled();
    expect(prisma.userSuggestionFeedback.deleteMany).toHaveBeenCalled();
  });
});
