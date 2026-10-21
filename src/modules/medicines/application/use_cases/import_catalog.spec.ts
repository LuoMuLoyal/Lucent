import { okAsync } from '../../../../common/result/index.js';
import {
  errAsync,
  createDomainFailure,
} from '../../../../common/result/index.js';
import { DomainFailureException } from '../../../../common/result/index.js';
import type { AuditLogService } from '../../../audit-log/index.js';
import type {
  MedicineSafetyTipAdminInput,
  MedicineSafetyTipAdminRow,
  MedicineSafetyTipEditableRow,
  MedicineSafetyTipRepositoryPort,
} from '../ports/safety_tips.js';
import type { MedicinesCacheMaintenancePort } from '../ports/cache_maintenance.js';
import type {
  QaChunkAdminRow,
  QaChunkEditableRow,
  QaChunkRepositoryPort,
} from '../ports/qa_chunks.js';
import {
  QaChunksAdminService,
  SafetyTipsAdminService,
} from './import_catalog.js';

/**
 * Orchestration tests for the content-admin use cases.
 *
 * Both services used to take `PrismaService` directly; after the ADR-0024 move
 * they depend on repository ports, so these tests speak to the ports and only
 * assert the use-case responsibilities: audit journaling, cache invalidation,
 * missing-row handling and the page window echoed back to the caller. The
 * Prisma query shapes and ISO serialisation they used to cover now live in
 * `infrastructure/persistence/{safety_tips,qa_chunks}.spec.ts`, where that
 * mapping actually happens.
 */
describe('SafetyTipsAdminService', () => {
  const tipRow: MedicineSafetyTipAdminRow = {
    id: 'tip-1',
    contentZh: '中文建议',
    contentEn: 'English advice',
    category: 'general',
    sortOrder: 1,
    isActive: true,
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const editableRow: MedicineSafetyTipEditableRow = {
    id: 'tip-1',
    contentZh: '中文建议',
    contentEn: 'English advice',
    category: 'general',
    sortOrder: 1,
    isActive: true,
  };
  const createInput: MedicineSafetyTipAdminInput = {
    contentZh: '中文建议',
    contentEn: 'English advice',
    category: 'general',
    sortOrder: 1,
    isActive: true,
  };

  function buildService() {
    const tips = {
      listAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findEditable: vi.fn(),
      remove: vi.fn(),
    };
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    const cacheMaintenance = { invalidateAll: vi.fn().mockResolvedValue(1) };
    const service = new SafetyTipsAdminService(
      audit as unknown as AuditLogService,
      tips as unknown as MedicineSafetyTipRepositoryPort,
      cacheMaintenance as unknown as MedicinesCacheMaintenancePort,
    );
    return {
      service,
      tips,
      audit,
      cacheMaintenance,
    };
  }

  it('creates a safety tip through the repository, invalidates cache, and records the actor', async () => {
    const { service, tips, audit, cacheMaintenance } = buildService();
    tips.create.mockResolvedValue(tipRow);

    await expect(service.create('actor-1', createInput)).resolves.toEqual(
      tipRow,
    );
    expect(tips.create).toHaveBeenCalledWith(createInput);
    expect(cacheMaintenance.invalidateAll).toHaveBeenCalledOnce();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor-1',
        action: 'admin.content.safety_tip.create',
        resourceType: 'medicine_safety_tip',
        resourceId: 'tip-1',
        // Prisma's JSON column rejects a `Date`, so the repository already
        // hands over the serialised row and audit metadata reuses it verbatim.
        metadata: { before: null, after: tipRow },
      }),
    );
  });

  it('lists rows straight from the repository', async () => {
    const { service, tips } = buildService();
    tips.listAll.mockResolvedValue([tipRow]);

    await expect(service.list()).resolves.toEqual([tipRow]);
    expect(tips.listAll).toHaveBeenCalledOnce();
  });

  it('updates through the repository and records the before/after snapshots', async () => {
    const { service, tips, audit, cacheMaintenance } = buildService();
    const updated = { ...tipRow, contentEn: 'Updated advice' };
    tips.findEditable.mockResolvedValue(editableRow);
    tips.update.mockResolvedValue(updated);

    await expect(
      service.update('actor-1', 'tip-1', { contentEn: 'Updated advice' }),
    ).resolves.toEqual(updated);
    expect(tips.update).toHaveBeenCalledWith('tip-1', {
      contentEn: 'Updated advice',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.content.safety_tip.update',
        resourceId: 'tip-1',
        metadata: { before: editableRow, after: updated },
      }),
    );
    expect(cacheMaintenance.invalidateAll).toHaveBeenCalledOnce();
  });

  it('returns null without touching cache or audit when the tip is unknown', async () => {
    const { service, tips, audit, cacheMaintenance } = buildService();
    tips.findEditable.mockResolvedValue(null);

    await expect(
      service.update('actor-1', 'missing', { contentEn: 'x' }),
    ).resolves.toBeNull();
    expect(tips.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(cacheMaintenance.invalidateAll).not.toHaveBeenCalled();
  });

  it('returns null when the row vanishes between the read and the write', async () => {
    const { service, tips, audit } = buildService();
    tips.findEditable.mockResolvedValue(editableRow);
    tips.update.mockResolvedValue(null);

    await expect(
      service.update('actor-1', 'tip-1', { contentEn: 'x' }),
    ).resolves.toBeNull();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('removes a tip, invalidates cache and audits the deleted snapshot', async () => {
    const { service, tips, audit, cacheMaintenance } = buildService();
    tips.findEditable.mockResolvedValue(editableRow);
    tips.remove.mockResolvedValue(undefined);

    await expect(service.remove('actor-1', 'tip-1')).resolves.toBe(true);
    expect(tips.remove).toHaveBeenCalledWith('tip-1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.content.safety_tip.delete',
        resourceId: 'tip-1',
        metadata: { before: editableRow, after: null },
      }),
    );
    expect(cacheMaintenance.invalidateAll).toHaveBeenCalledOnce();
  });

  it('reports a missing tip on remove without writing, auditing or bouncing the cache', async () => {
    const { service, tips, audit, cacheMaintenance } = buildService();
    tips.findEditable.mockResolvedValue(null);

    await expect(service.remove('actor-1', 'missing')).resolves.toBe(false);
    expect(tips.remove).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(cacheMaintenance.invalidateAll).not.toHaveBeenCalled();
  });

  it('surfaces an audit failure instead of silently keeping the change', async () => {
    const { service, tips, audit, cacheMaintenance } = buildService();
    tips.create.mockResolvedValue(tipRow);
    audit.log.mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'internal',
          code: 'INTERNAL_ERROR',
          detail: 'audit sink unavailable',
        }),
      ),
    );

    await expect(service.create('actor-1', createInput)).rejects.toThrow(
      DomainFailureException,
    );
    // The cache must not be treated as refreshed when the write is unrecorded.
    expect(cacheMaintenance.invalidateAll).not.toHaveBeenCalled();
  });
});

describe('QaChunksAdminService', () => {
  const chunkRow: QaChunkAdminRow = {
    id: 'chunk-1',
    qaId: 'Q-1',
    question: '高血压怎么预防？',
    answer: '低盐饮食、规律运动、控制体重。',
    safetyLabel: 'safe',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const editableRow: QaChunkEditableRow = {
    id: 'chunk-1',
    qaId: 'Q-1',
    question: '高血压怎么预防？',
    answer: '低盐饮食、规律运动、控制体重。',
    safetyLabel: 'safe',
  };

  function buildService() {
    const chunks = {
      list: vi.fn(),
      findEditable: vi.fn(),
      update: vi.fn(),
    };
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    return {
      service: new QaChunksAdminService(
        audit as unknown as AuditLogService,
        chunks as unknown as QaChunkRepositoryPort,
      ),
      chunks,
      audit,
    };
  }

  it('echoes the requested page window around the repository page', async () => {
    const { service, chunks } = buildService();
    chunks.list.mockResolvedValue({ items: [chunkRow], total: 1 });

    const listed = await service.list({ page: 2, limit: 10 });

    expect(listed).toEqual({
      items: [chunkRow],
      total: 1,
      page: 2,
      limit: 10,
    });
    expect(chunks.list).toHaveBeenCalledWith({ page: 2, limit: 10 });
  });

  it('passes the search and label filters through to the repository', async () => {
    const { service, chunks } = buildService();
    chunks.list.mockResolvedValue({ items: [], total: 0 });

    await service.list({
      page: 1,
      limit: 25,
      q: '高血压',
      safetyLabel: 'safe',
    });

    expect(chunks.list).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      q: '高血压',
      safetyLabel: 'safe',
    });
  });

  it('updates only the supplied fields and records before/after summaries', async () => {
    const { service, chunks, audit } = buildService();
    const updated = { ...chunkRow, safetyLabel: 'blocked' };
    chunks.findEditable.mockResolvedValue(editableRow);
    chunks.update.mockResolvedValue(updated);

    await expect(
      service.update('actor-1', 'chunk-1', { safetyLabel: 'blocked' }),
    ).resolves.toEqual(updated);
    expect(chunks.update).toHaveBeenCalledWith('chunk-1', {
      safetyLabel: 'blocked',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.content.qa_chunk.update',
        resourceType: 'medical_qa_chunk',
        resourceId: 'chunk-1',
        metadata: { before: editableRow, after: updated },
      }),
    );
  });

  it('returns null without auditing when the chunk is unknown', async () => {
    const { service, chunks, audit } = buildService();
    chunks.findEditable.mockResolvedValue(null);

    await expect(
      service.update('actor-1', 'missing', { question: 'changed' }),
    ).resolves.toBeNull();
    expect(chunks.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('returns null when the row vanishes between the read and the write', async () => {
    const { service, chunks, audit } = buildService();
    chunks.findEditable.mockResolvedValue(editableRow);
    chunks.update.mockResolvedValue(null);

    await expect(
      service.update('actor-1', 'chunk-1', { question: 'changed' }),
    ).resolves.toBeNull();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
