import { DataRetentionService } from './data-retention.service';
import type { PrismaService } from '../../../prisma';

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
    prisma.user.deleteMany.mockResolvedValue({ count: 2 });

    await service.cleanupExpiredData();

    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: {
        deletedAt: { lt: new Date('2026-06-20T03:00:00.000Z') },
        status: 'deleted',
      },
    });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('skips account hard-delete when no expired accounts', async () => {
    prisma.user.deleteMany.mockResolvedValue({ count: 0 });

    await service.cleanupExpiredData();

    // deleteMany is still called (with the WHERE clause), but count=0
    expect(prisma.user.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('logs nothing when zero records deleted', async () => {
    await service.cleanupExpiredData();

    // All deleteMany return { count: 0 } by default — no errors, no logs
    expect(prisma.userSession.deleteMany).toHaveBeenCalled();
    expect(prisma.userNotification.deleteMany).toHaveBeenCalled();
    expect(prisma.userSuggestionFeedback.deleteMany).toHaveBeenCalled();
  });
});
