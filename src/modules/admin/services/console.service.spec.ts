import { AdminRole, UserStatus } from '#generated/prisma/client.js';
import type { PrismaService } from '../../../prisma/index.js';
import type { AuditLogService } from '../../audit-log/index.js';
import { AdminConsoleService } from './console.service.js';

function buildPrisma() {
  return {
    nonDeleted: {
      user: {
        count: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
    userProductEvent: { count: vi.fn() },
    adminUser: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

describe('AdminConsoleService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let auditLogService: { listEntries: ReturnType<typeof vi.fn> };
  let service: AdminConsoleService;

  beforeEach(() => {
    prisma = buildPrisma();
    auditLogService = { listEntries: vi.fn() };
    service = new AdminConsoleService(
      prisma as unknown as PrismaService,
      auditLogService as unknown as AuditLogService,
    );
  });

  it('returns aggregate metrics without user-level details', async () => {
    prisma.nonDeleted.user.count
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    prisma.userProductEvent.count.mockResolvedValue(17);

    const result = await service.getOverview();

    expect(result.users).toEqual({
      total: 10,
      active: 8,
      suspended: 2,
      newLast30Days: 3,
    });
    expect(result.productEventsLast24Hours).toBe(17);
    expect(result).not.toHaveProperty('userIds');
  });

  it('filters user summaries, bounds the page, and omits health profile fields', async () => {
    const createdAt = new Date('2026-10-01T12:00:00.000Z');
    prisma.nonDeleted.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        email: 'amy@example.com',
        nickname: 'Amy',
        status: UserStatus.active,
        emailVerified: true,
        createdAt,
        lastLoginAt: null,
        adminUser: { role: AdminRole.EDITOR },
      },
    ]);
    prisma.nonDeleted.user.count.mockResolvedValue(1);
    prisma.adminUser.findMany.mockResolvedValue([
      { userId: 'user-1', role: AdminRole.EDITOR },
    ]);

    const result = await service.listUsers({
      page: 2,
      limit: 10,
      q: 'amy',
      status: UserStatus.active,
    });

    expect(result).toMatchObject({
      total: 1,
      page: 2,
      limit: 10,
      items: [
        {
          id: 'user-1',
          email: 'amy@example.com',
          status: UserStatus.active,
          adminRole: AdminRole.EDITOR,
        },
      ],
    });
    expect(result.items[0]).not.toHaveProperty('profile');
    expect(prisma.nonDeleted.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: UserStatus.active,
          OR: [
            { email: { contains: 'amy', mode: 'insensitive' } },
            { nickname: { contains: 'amy', mode: 'insensitive' } },
          ],
        },
        skip: 10,
        take: 10,
      }),
    );
  });

  it('returns null for deleted or unknown user IDs', async () => {
    prisma.nonDeleted.user.findFirst.mockResolvedValue(null);

    await expect(service.getUser('missing')).resolves.toBeNull();
    expect(prisma.nonDeleted.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'missing', status: { not: UserStatus.deleted } },
      }),
    );
  });

  it('delegates filtered audit pagination to AuditLogService', async () => {
    const page = { items: [], total: 0, page: 1, limit: 20 };
    auditLogService.listEntries.mockResolvedValue(page);

    await expect(
      service.listAuditLogs({
        page: 1,
        limit: 20,
        actorUserId: 'user-1',
        action: 'admin.update',
        resourceType: 'user',
      }),
    ).resolves.toEqual(page);
    expect(auditLogService.listEntries).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      userId: 'user-1',
      action: 'admin.update',
      resourceType: 'user',
    });
  });
});
