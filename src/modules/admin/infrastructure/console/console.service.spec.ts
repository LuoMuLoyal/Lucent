import { AdminRole, UserStatus } from '#generated/prisma/client.js';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../../prisma/index.js';
import type { AuditLogService } from '../../../audit-log/index.js';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
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
  let configValues: Record<string, string>;
  /** Keys the (fake) published document declares; everything else falls back. */
  let runtimeValues: Record<string, unknown>;
  let service: AdminConsoleService;

  beforeEach(() => {
    prisma = buildPrisma();
    auditLogService = { listEntries: vi.fn() };
    configValues = {};
    runtimeValues = {};
    const runtime: RuntimeConfigPort = {
      getSnapshot: () => ({
        values: runtimeValues as never,
        version: 'test#1',
        source: 'remote',
        revision: 'test',
        seq: 1,
      }),
      getVersion: () => 'test#1',
      applyDocument: () => ({ ok: true, version: 'test#1', changed: [] }),
      subscribe: () => () => undefined,
    };
    const configService = {
      get: (key: string) => configValues[key],
    };
    service = new AdminConsoleService(
      prisma as unknown as PrismaService,
      auditLogService as unknown as AuditLogService,
      configService as unknown as ConfigService,
      runtime,
    );
  });

  it('reports the sidecar enablement flags without endpoints or keys', () => {
    configValues = {
      [EnvKey.LIGHTRAG_ENABLED]: 'true',
      [EnvKey.SEMANTICA_ENABLED]: 'false',
    };

    const status = service.getDependencies();

    expect(status.lightrag.enabled).toBe(true);
    expect(status.semantica.enabled).toBe(false);
    expect(typeof status.generatedAt).toBe('string');
    expect(Object.keys(status)).toEqual([
      'lightrag',
      'semantica',
      'generatedAt',
    ]);
  });

  it('reports the flags published in the snapshot over the environment', () => {
    configValues = {
      [EnvKey.LIGHTRAG_ENABLED]: 'true',
      [EnvKey.SEMANTICA_ENABLED]: 'true',
    };
    runtimeValues = {
      [EnvKey.LIGHTRAG_ENABLED]: false,
      [EnvKey.SEMANTICA_ENABLED]: false,
    };

    const status = service.getDependencies();

    expect(status.lightrag.enabled).toBe(false);
    expect(status.semantica.enabled).toBe(false);
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
