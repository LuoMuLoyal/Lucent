import { AuditLogService } from './audit-log.service.js';
import type { PrismaService } from '../../../prisma/index.js';
import { Prisma } from '#generated/prisma/client.js';
import type { MetricsService } from '../../../common/metrics/metrics.service.js';
import type {
  ResultAsync,
  DomainFailure,
} from '../../../common/result/index.js';

/** Folds a ResultAsync into a plain outcome so specs can assert code/value. */
async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

function buildPrisma() {
  return {
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

function buildMetrics() {
  return {
    recordAuditLogWriteFailure: vi.fn(),
  } as unknown as MetricsService;
}

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: ReturnType<typeof buildPrisma>;
  let metrics: MetricsService;

  beforeEach(() => {
    prisma = buildPrisma();
    metrics = buildMetrics();
    service = new AuditLogService(prisma as unknown as PrismaService, metrics);
  });

  it('lists paginated entries without metadata, IP, or user-agent fields', async () => {
    const createdAt = new Date('2026-10-01T12:00:00.000Z');
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        userId: 'user-1',
        action: 'admin.user.read',
        resourceType: 'user',
        resourceId: 'target-1',
        createdAt,
      },
    ]);
    prisma.auditLog.count.mockResolvedValue(1);

    await expect(
      service.listEntries({
        page: 2,
        limit: 10,
        userId: 'user-1',
        action: 'admin.user.read',
        resourceType: 'user',
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'audit-1',
          userId: 'user-1',
          action: 'admin.user.read',
          resourceType: 'user',
          resourceId: 'target-1',
          createdAt: createdAt.toISOString(),
        },
      ],
      total: 1,
      page: 2,
      limit: 10,
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        action: 'admin.user.read',
        resourceType: 'user',
      },
      select: {
        id: true,
        userId: true,
        action: true,
        resourceType: true,
        resourceId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    });
  });

  // ── log() ────────────────────────────────────────────────────────

  it('persists a full audit log entry with all fields', async () => {
    const outcome = await collectResult(
      service.log({
        userId: 'user-1',
        action: 'password.change',
        resourceType: 'user',
        resourceId: 'user-1',
        metadata: { reason: 'user_initiated' },
        ipAddress: '10.0.0.1',
        userAgent: 'Luminous/1.0',
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'password.change',
        resourceType: 'user',
        resourceId: 'user-1',
        ipAddress: '10.0.0.1',
        userAgent: 'Luminous/1.0',
      }),
    });
  });

  it('persists with null defaults when optional fields are omitted', async () => {
    const outcome = await collectResult(
      service.log({
        userId: 'user-1',
        action: 'account.delete',
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'account.delete',
        resourceType: null,
        resourceId: null,
        ipAddress: null,
        userAgent: null,
      }),
    });
  });

  it('maps a known Prisma request error to a DomainFailure Err', async () => {
    prisma.auditLog.create.mockRejectedValue(
      Object.assign(
        Object.create(Prisma.PrismaClientKnownRequestError.prototype),
        {
          code: 'P2002',
        },
      ) as Error,
    );

    const outcome = await collectResult(
      service.log({ userId: 'user-1', action: 'test' }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('RESOURCE_CONFLICT');
  });

  it('rethrows unknown database errors instead of mapping them', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('DB connection lost'));

    await expect(
      collectResult(service.log({ userId: 'user-1', action: 'test' })),
    ).rejects.toThrow('DB connection lost');
  });

  // ── logFireAndForget() ────────────────────────────────────────────

  it('triggers log without awaiting (fire-and-forget)', () => {
    const logSpy = vi.spyOn(service, 'log');

    service.logFireAndForget({
      userId: 'user-1',
      action: 'password.change',
    });

    expect(logSpy).toHaveBeenCalledWith({
      userId: 'user-1',
      action: 'password.change',
    });
  });

  it('does not block when fire-and-forget write fails', () => {
    prisma.auditLog.create.mockRejectedValue(new Error('write error'));

    // Should not throw
    expect(() => {
      service.logFireAndForget({
        userId: 'user-1',
        action: 'test',
      });
    }).not.toThrow();
  });

  it('records a failure metric and structured log when the write returns an Err', async () => {
    const loggerSpy = vi
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);
    prisma.auditLog.create.mockRejectedValue(
      Object.assign(
        Object.create(Prisma.PrismaClientKnownRequestError.prototype),
        {
          code: 'P2002',
        },
      ) as Error,
    );

    service.logFireAndForget({
      userId: 'user-1',
      action: 'password.change',
    });
    // Let the fire-and-forget chain settle.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(metrics.recordAuditLogWriteFailure).toHaveBeenCalledWith(
      'password.change',
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('password.change'),
    );
    loggerSpy.mockRestore();
  });

  it('records a failure metric and structured log when the write rejects', async () => {
    const loggerSpy = vi
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);
    prisma.auditLog.create.mockRejectedValue(new Error('DB connection lost'));

    service.logFireAndForget({
      userId: 'user-1',
      action: 'account.delete',
    });
    // Let the fire-and-forget chain settle.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(metrics.recordAuditLogWriteFailure).toHaveBeenCalledWith(
      'account.delete',
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('account.delete'),
    );
    loggerSpy.mockRestore();
  });

  it('does not record a failure metric on success', async () => {
    service.logFireAndForget({
      userId: 'user-1',
      action: 'password.change',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(metrics.recordAuditLogWriteFailure).not.toHaveBeenCalled();
  });
});
