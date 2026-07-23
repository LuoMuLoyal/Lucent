import { AuditLogService } from './audit-log.service';
import type { PrismaService } from '../../../prisma';

function buildPrisma() {
  return {
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new AuditLogService(prisma as unknown as PrismaService);
  });

  // ── log() ────────────────────────────────────────────────────────

  it('persists a full audit log entry with all fields', async () => {
    await service.log({
      userId: 'user-1',
      action: 'password.change',
      resourceType: 'user',
      resourceId: 'user-1',
      metadata: { reason: 'user_initiated' },
      ipAddress: '10.0.0.1',
      userAgent: 'Luminous/1.0',
    });

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
    await service.log({
      userId: 'user-1',
      action: 'account.delete',
    });

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

  // ── Error handling ───────────────────────────────────────────────

  it('swallows write errors and does not throw', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('DB connection lost'));

    await expect(
      service.log({ userId: 'user-1', action: 'test' }),
    ).resolves.toBeUndefined();
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
});
