import { okAsync } from '../../../common/result/index.js';
import type { PrismaService } from '../../../prisma/index.js';
import type { AuditLogService } from '../../audit-log/index.js';
import type { MedicinesCacheAdminService } from '../cache/admin.service.js';
import {
  QaChunksAdminService,
  SafetyTipsAdminService,
} from './admin.service.js';

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

describe('QaChunksAdminService', () => {
  const stored = {
    id: 'chunk-1',
    qaId: 'Q-1',
    question: '高血压怎么预防？',
    answer: '低盐饮食、规律运动、控制体重。',
    safetyLabel: 'safe',
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  };
  const expected = { ...stored, updatedAt: '2026-10-01T00:00:00.000Z' };

  function buildService() {
    const rows = {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    };
    const prisma = { medicalQaChunk: rows } as unknown as PrismaService;
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    return {
      service: new QaChunksAdminService(
        prisma,
        audit as unknown as AuditLogService,
      ),
      rows,
      audit,
    };
  }

  it('serializes list timestamps and echoes the page window', async () => {
    const { service, rows } = buildService();
    rows.findMany.mockResolvedValue([stored]);
    rows.count.mockResolvedValue(1);

    const listed = await service.list({ page: 2, limit: 10 });

    expect(listed).toEqual({
      items: [expected],
      total: 1,
      page: 2,
      limit: 10,
    });
    expect(rows.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10, where: {} }),
    );
  });

  it('searches qaId, question and answer case-insensitively', async () => {
    const { service, rows } = buildService();
    rows.findMany.mockResolvedValue([]);
    rows.count.mockResolvedValue(0);

    await service.list({
      page: 1,
      limit: 25,
      q: '高血压',
      safetyLabel: 'safe',
    });

    expect(rows.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          safetyLabel: 'safe',
          OR: [
            { qaId: { contains: '高血压', mode: 'insensitive' } },
            { question: { contains: '高血压', mode: 'insensitive' } },
            { answer: { contains: '高血压', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('updates only the supplied fields and records before/after summaries', async () => {
    const { service, rows, audit } = buildService();
    rows.findUnique.mockResolvedValue(stored);
    rows.update.mockResolvedValue({ ...stored, safetyLabel: 'blocked' });

    await expect(
      service.update('actor-1', 'chunk-1', { safetyLabel: 'blocked' }),
    ).resolves.toEqual({ ...expected, safetyLabel: 'blocked' });
    expect(rows.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'chunk-1' },
        data: { safetyLabel: 'blocked' },
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.content.qa_chunk.update',
        resourceType: 'medical_qa_chunk',
        resourceId: 'chunk-1',
        metadata: {
          before: expect.objectContaining({ safetyLabel: 'safe' }),
          after: expect.objectContaining({
            safetyLabel: 'blocked',
            updatedAt: '2026-10-01T00:00:00.000Z',
          }),
        },
      }),
    );
  });

  it('returns null without auditing when the chunk is unknown', async () => {
    const { service, rows, audit } = buildService();
    rows.findUnique.mockResolvedValue(null);

    await expect(
      service.update('actor-1', 'missing', { question: 'changed' }),
    ).resolves.toBeNull();
    expect(rows.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
