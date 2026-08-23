import type { PrismaService } from '../../../prisma';
import type { ResultAsync, DomainFailure } from '../../../common/result';
import { LegalDocumentsService } from './documents.service';

/** Folds a ResultAsync into a plain outcome so specs can assert code/value. */
async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('LegalDocumentsService', () => {
  let service: LegalDocumentsService;

  const mockRows = [
    {
      id: '1',
      docType: 'terms',
      titleZh: '用户协议',
      titleEn: 'Terms of Service',
      contentZh: '# 用户协议\n\n内容',
      contentEn: '# Terms of Service\n\nContent',
      isActive: true,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      updatedAt: new Date('2026-07-11T10:00:00.000Z'),
    },
    {
      id: '2',
      docType: 'privacy',
      titleZh: '隐私政策',
      titleEn: 'Privacy Policy',
      contentZh: '# 隐私政策\n\n内容',
      contentEn: '# Privacy Policy\n\nContent',
      isActive: true,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      updatedAt: new Date('2026-07-11T12:00:00.000Z'),
    },
    {
      id: '3',
      docType: 'disclaimer',
      titleZh: '医疗免责声明',
      titleEn: 'Medical Disclaimer',
      contentZh: '# 医疗免责声明\n\n内容',
      contentEn: '# Medical Disclaimer\n\nContent',
      isActive: false,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      updatedAt: new Date('2026-07-09T08:00:00.000Z'),
    },
  ];

  function createMockPrisma(rows = mockRows): PrismaService {
    const sortedActive = rows
      .filter((r) => r.isActive)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return {
      legalDocument: {
        findMany: vi.fn().mockResolvedValue(sortedActive),
        findUnique: vi
          .fn()
          .mockImplementation(({ where }: { where: { docType: string } }) =>
            Promise.resolve(
              rows.find((r) => r.docType === where.docType) ?? null,
            ),
          ),
      },
    } as unknown as PrismaService;
  }

  function createMockCache(): { get: vi.Mock; set: vi.Mock } {
    return {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(() => {
    service = new LegalDocumentsService(
      createMockPrisma(),
      createMockCache() as never,
    );
  });

  describe('findAll', () => {
    it('returns active documents with Chinese titles by default', async () => {
      const result = await collectResult(service.findAll({}));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.items).toHaveLength(2);
      // sorted by updatedAt desc: privacy (12:00) before terms (10:00)
      expect(result.value.items[0]!.docType).toBe('privacy');
      expect(result.value.items[0]!.title).toBe('隐私政策');
      expect(result.value.items[1]!.docType).toBe('terms');
      expect(result.value.items[1]!.title).toBe('用户协议');
      expect(result.value.updatedAt).toBe('2026-07-11T12:00:00.000Z');
    });

    it('returns active documents with English titles when lang=en', async () => {
      const result = await collectResult(service.findAll({ lang: 'en' }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.items).toHaveLength(2);
      expect(result.value.items[0]!.title).toBe('Privacy Policy');
      expect(result.value.items[1]!.title).toBe('Terms of Service');
    });

    it('returns items sorted by updatedAt desc', async () => {
      const result = await collectResult(service.findAll({}));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.items[0]!.updatedAt).toBe('2026-07-11T12:00:00.000Z');
      expect(result.value.items[1]!.updatedAt).toBe('2026-07-11T10:00:00.000Z');
    });

    it('returns current timestamp when no documents exist', async () => {
      service = new LegalDocumentsService(
        createMockPrisma([]),
        createMockCache() as never,
      );
      const result = await collectResult(service.findAll({}));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.items).toHaveLength(0);
      expect(result.value.updatedAt).toBeTruthy();
    });

    it('serves from the database when the cache read fails (best-effort)', async () => {
      const cache = createMockCache();
      cache.get.mockRejectedValue(new Error('redis down'));
      service = new LegalDocumentsService(createMockPrisma(), cache as never);

      const result = await collectResult(service.findAll({}));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(2);
    });

    it('does not fail the response when the cache write fails (best-effort)', async () => {
      const cache = createMockCache();
      cache.set.mockRejectedValue(new Error('redis down'));
      service = new LegalDocumentsService(createMockPrisma(), cache as never);

      const result = await collectResult(service.findAll({}));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(2);
      // Give the fire-and-forget cache write a tick to reject.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe('findOne', () => {
    it('returns Chinese content by default', async () => {
      const result = await collectResult(service.findOne('terms', {}));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.docType).toBe('terms');
      expect(result.value.title).toBe('用户协议');
      expect(result.value.content).toBe('# 用户协议\n\n内容');
      expect(result.value.updatedAt).toBe('2026-07-11T10:00:00.000Z');
    });

    it('returns English content when lang=en', async () => {
      const result = await collectResult(
        service.findOne('terms', { lang: 'en' }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.title).toBe('Terms of Service');
      expect(result.value.content).toBe('# Terms of Service\n\nContent');
    });

    it('returns LEGAL_DOCUMENT_NOT_FOUND for unknown docType', async () => {
      const result = await collectResult(service.findOne('nonexistent', {}));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('LEGAL_DOCUMENT_NOT_FOUND');
      expect(result.error.kind).toBe('not_found');
    });

    it('returns LEGAL_DOCUMENT_NOT_FOUND for inactive documents', async () => {
      const result = await collectResult(service.findOne('disclaimer', {}));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('LEGAL_DOCUMENT_NOT_FOUND');
    });

    it('serves from the database when the cache read fails (best-effort)', async () => {
      const cache = createMockCache();
      cache.get.mockRejectedValue(new Error('redis down'));
      service = new LegalDocumentsService(createMockPrisma(), cache as never);

      const result = await collectResult(service.findOne('terms', {}));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.docType).toBe('terms');
    });
  });
});
