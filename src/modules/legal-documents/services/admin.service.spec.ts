import { okAsync } from '../../../common/result/index.js';
import type { PrismaService } from '../../../prisma/index.js';
import type { AuditLogService } from '../../audit-log/index.js';
import type { LegalDocumentsService } from './documents.service.js';
import { LegalDocumentsAdminService } from './admin.service.js';

describe('LegalDocumentsAdminService', () => {
  function buildService() {
    const rows = {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    };
    const prisma = { legalDocument: rows } as unknown as PrismaService;
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    const invalidateDocumentCache = vi.fn().mockResolvedValue(undefined);
    const documents = { invalidateDocumentCache };
    const service = new LegalDocumentsAdminService(
      prisma,
      audit as unknown as AuditLogService,
      documents as unknown as LegalDocumentsService,
    );
    return { service, rows, audit, invalidateDocumentCache };
  }

  it('serializes list timestamps as ISO strings', async () => {
    const { service, rows } = buildService();
    rows.findMany.mockResolvedValue([
      {
        docType: 'terms',
        titleZh: '服务条款',
        titleEn: 'Terms',
        contentZh: '# 条款',
        contentEn: '# Terms',
        isActive: true,
        updatedAt: new Date('2026-10-02T00:00:00.000Z'),
      },
    ]);

    const listed = await service.list();

    expect(listed).toEqual([
      expect.objectContaining({
        docType: 'terms',
        updatedAt: '2026-10-02T00:00:00.000Z',
      }),
    ]);
    // A `Date` here fails the response schema and surfaces as a 500.
    expect(typeof listed[0]?.updatedAt).toBe('string');
  });

  it('updates a legal document, invalidates public caches, and records actor plus summaries', async () => {
    const { service, rows, audit, invalidateDocumentCache } = buildService();
    const before = {
      titleZh: '旧标题',
      titleEn: 'Old title',
      isActive: true,
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    const after = {
      docType: 'terms',
      titleZh: '新标题',
      titleEn: 'New title',
      contentZh: '# Terms',
      contentEn: '# Terms',
      isActive: true,
      updatedAt: new Date('2026-10-02T00:00:00.000Z'),
    };
    rows.findUnique.mockResolvedValue(before);
    rows.update.mockResolvedValue(after);

    await expect(
      service.update('actor-1', 'terms', { titleZh: '新标题' }),
    ).resolves.toEqual({
      ...after,
      updatedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(invalidateDocumentCache).toHaveBeenCalledWith('terms');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor-1',
        action: 'admin.content.legal_document.update',
        resourceType: 'legal_document',
        resourceId: 'terms',
        metadata: {
          changedFields: ['titleZh'],
          before: expect.objectContaining({ titleZh: '旧标题' }),
          after: expect.objectContaining({ titleZh: '新标题' }),
        },
      }),
    );
  });

  it('returns null without writing audit records when the document is unknown', async () => {
    const { service, rows, audit } = buildService();
    rows.findUnique.mockResolvedValue(null);

    await expect(service.update('actor-1', 'missing', {})).resolves.toBeNull();
    expect(audit.log).not.toHaveBeenCalled();
    expect(rows.update).not.toHaveBeenCalled();
  });
});
