import { okAsync } from '../../../common/result/index.js';
import type { PrismaService } from '../../../prisma/index.js';
import type { AuditLogService } from '../../audit-log/index.js';
import type { MedicinesCacheAdminService } from '../cache/admin.service.js';
import { SafetyTipsAdminService } from './admin.service.js';

describe('SafetyTipsAdminService', () => {
  const created = {
    id: 'tip-1',
    contentZh: '中文建议',
    contentEn: 'English advice',
    category: 'general',
    sortOrder: 1,
    isActive: true,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  };
  const expectedTip = { ...created, updatedAt: '2026-10-01T00:00:00.000Z' };

  function buildService() {
    const rows = {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const prisma = { medicineSafetyTip: rows } as unknown as PrismaService;
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    const cacheAdmin = { invalidateAll: vi.fn().mockResolvedValue(1) };
    const service = new SafetyTipsAdminService(
      prisma,
      audit as unknown as AuditLogService,
      cacheAdmin as unknown as MedicinesCacheAdminService,
    );
    return { service, rows, audit, cacheAdmin };
  }

  it('creates a safety tip, invalidates cache, and records the actor', async () => {
    const { service, rows, audit, cacheAdmin } = buildService();
    rows.create.mockResolvedValue(created);

    await expect(
      service.create('actor-1', {
        contentZh: '中文建议',
        contentEn: 'English advice',
        category: 'general',
        sortOrder: 1,
        isActive: true,
      }),
    ).resolves.toEqual(expectedTip);
    expect(cacheAdmin.invalidateAll).toHaveBeenCalledOnce();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor-1',
        action: 'admin.content.safety_tip.create',
        resourceType: 'medicine_safety_tip',
        resourceId: 'tip-1',
        // Prisma's JSON column rejects a `Date`, so metadata carries the
        // serialized shape rather than the raw row.
        metadata: { before: null, after: expectedTip },
      }),
    );
  });

  it('serializes list timestamps as ISO strings', async () => {
    const { service, rows } = buildService();
    rows.findMany.mockResolvedValue([created]);

    const listed = await service.list();

    expect(listed).toEqual([expectedTip]);
    expect(typeof listed[0]?.updatedAt).toBe('string');
  });

  it('serializes update timestamps and records the before/after summaries', async () => {
    const { service, rows, audit } = buildService();
    rows.findUnique.mockResolvedValue({
      id: 'tip-1',
      contentZh: '中文建议',
      contentEn: 'English advice',
      category: 'general',
      sortOrder: 1,
      isActive: true,
    });
    rows.update.mockResolvedValue({ ...created, contentEn: 'Updated advice' });

    await expect(
      service.update('actor-1', 'tip-1', { contentEn: 'Updated advice' }),
    ).resolves.toEqual({ ...expectedTip, contentEn: 'Updated advice' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.content.safety_tip.update',
        resourceId: 'tip-1',
        metadata: {
          before: expect.objectContaining({ contentEn: 'English advice' }),
          after: expect.objectContaining({
            contentEn: 'Updated advice',
            updatedAt: '2026-10-01T00:00:00.000Z',
          }),
        },
      }),
    );
  });

  it('returns null without touching cache or audit when the tip is unknown', async () => {
    const { service, rows, audit, cacheAdmin } = buildService();
    rows.findUnique.mockResolvedValue(null);

    await expect(
      service.update('actor-1', 'missing', { contentEn: 'x' }),
    ).resolves.toBeNull();
    expect(audit.log).not.toHaveBeenCalled();
    expect(cacheAdmin.invalidateAll).not.toHaveBeenCalled();
  });
});
