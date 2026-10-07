import { okAsync } from '../../../common/result/index.js';
import type { PrismaService } from '../../../prisma/index.js';
import type { AuditLogService } from '../../audit-log/index.js';
import type { LegalDocumentsService } from './documents.service.js';
import { LegalDocumentsAdminService } from './admin.service.js';

describe('LegalDocumentsAdminService', () => {
  it('updates a legal document, invalidates public caches, and records actor plus summaries', async () => {
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
    const prisma = {
      legalDocument: {
        findUnique: vi.fn().mockResolvedValue(before),
        update: vi.fn().mockResolvedValue(after),
      },
    } as unknown as PrismaService;
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    const invalidateDocumentCache = vi.fn().mockResolvedValue(undefined);
    const documents = { invalidateDocumentCache };
    const service = new LegalDocumentsAdminService(
      prisma,
      audit as unknown as AuditLogService,
      documents as unknown as LegalDocumentsService,
    );

    await expect(
      service.update('actor-1', 'terms', { titleZh: '新标题' }),
    ).resolves.toEqual(after);
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
});
