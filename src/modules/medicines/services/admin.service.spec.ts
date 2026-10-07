import { okAsync } from '../../../common/result/index.js';
import type { PrismaService } from '../../../prisma/index.js';
import type { AuditLogService } from '../../audit-log/index.js';
import type { MedicinesCacheAdminService } from '../cache/admin.service.js';
import { SafetyTipsAdminService } from './admin.service.js';

describe('SafetyTipsAdminService', () => {
  it('creates a safety tip, invalidates cache, and records the actor', async () => {
    const created = {
      id: 'tip-1',
      contentZh: '中文建议',
      contentEn: 'English advice',
      category: 'general',
      sortOrder: 1,
      isActive: true,
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    const prisma = {
      medicineSafetyTip: {
        create: vi.fn().mockResolvedValue(created),
      },
    } as unknown as PrismaService;
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    const cacheAdmin = { invalidateAll: vi.fn().mockResolvedValue(1) };
    const service = new SafetyTipsAdminService(
      prisma,
      audit as unknown as AuditLogService,
      cacheAdmin as unknown as MedicinesCacheAdminService,
    );

    await expect(
      service.create('actor-1', {
        contentZh: '中文建议',
        contentEn: 'English advice',
        category: 'general',
        sortOrder: 1,
        isActive: true,
      }),
    ).resolves.toEqual(created);
    expect(cacheAdmin.invalidateAll).toHaveBeenCalledOnce();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor-1',
        action: 'admin.content.safety_tip.create',
        resourceType: 'medicine_safety_tip',
        resourceId: 'tip-1',
        metadata: { before: null, after: created },
      }),
    );
  });
});
