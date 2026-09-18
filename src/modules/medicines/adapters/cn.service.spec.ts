import type { DeepMocked } from '../../../common/types/deep-mocked.js';

import type { CnMedicineDetailDto } from '../dto/detail.dto.js';
import { CnMedicinesService } from './cn.service.js';
import type { PrismaService } from '../../../prisma/index.js';

describe('CnMedicinesService', () => {
  let service: CnMedicinesService;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      cnMedicineProduct: {
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
      },
    } as unknown as DeepMocked<PrismaService>;

    service = new CnMedicinesService(prisma);
  });

  function makeRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'med-1',
      name: '阿司匹林',
      brandName: 'Bayprus',
      approvalNumber: 'H12345678',
      manufacturer: 'Bayer',
      packageSpec: '100片/瓶',
      drugType: '化学药品',
      mainCategory: '镇痛药',
      subcategory: '解热镇痛',
      barcode: '6900000000001',
      nationalDrugCode: 'H12345678',
      searchText: '阿司匹林 拜耳',
      imageUrl: 'https://example.com/img.jpg',
      sourceUrl: 'https://example.com/source',
      ...overrides,
    };
  }

  function makeLeaflet(overrides: Record<string, unknown> = {}) {
    return {
      id: 'leaf-1',
      instructionId: 'YAOZS-000001',
      sourceRow: 2,
      sourceUrl: 'https://example.com/leaflet',
      genericName: '阿司匹林',
      brandName: 'Bayprus',
      approvalText: '国药准字H12345678',
      approvalCodes: ['H12345678'],
      category: '化学药品',
      manufacturer: 'Bayer',
      manufacturerClean: 'Bayer',
      regulatoryClass: '处方药',
      relatedDiseases: null,
      appearance: '白色片剂',
      ingredients: '阿司匹林',
      indications: '用于镇痛',
      packageSpec: '100片/瓶',
      adverseReactions: '胃肠道不适',
      dosage: '口服',
      contraindications: '对本品过敏者禁用',
      precautions: '孕妇慎用',
      pregnancyLactation: null,
      pediatricUse: null,
      geriatricUse: null,
      drugInteractions: null,
      pharmacologyToxicology: null,
      pharmacokinetics: null,
      storage: '密封保存',
      validityPeriod: '36个月',
      ...overrides,
    };
  }

  describe('search', () => {
    it('returns paginated search results', async () => {
      const rows = [makeRow()];
      prisma.cnMedicineProduct.findMany.mockResolvedValue(rows);
      prisma.cnMedicineProduct.count.mockResolvedValue(1);

      const result = await service.search({
        q: '阿司匹林',
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('med-1');
      expect(result.items[0]!.source).toBe('cn');
      expect(result.items[0]!.name).toBe('阿司匹林');
      expect(result.pagination).toBeDefined();
      expect(result.pagination.total).toBe(1);
    });

    it('reports only business keys in matchedBy, never searchText', async () => {
      prisma.cnMedicineProduct.findMany.mockResolvedValue([makeRow()]);
      prisma.cnMedicineProduct.count.mockResolvedValue(1);

      // Query hits `name` — which is also a prefix of `searchText` — but the
      // internal index field must not appear as a matched key.
      const result = await service.search({
        q: '阿司匹林',
        page: 1,
        pageSize: 10,
      });

      expect(result.items[0]!.matchedBy).toEqual(['name']);
      expect(result.items[0]!.matchedBy).not.toContain('searchText');
    });

    it('builds where clause with nested OR conditions for query', async () => {
      prisma.cnMedicineProduct.findMany.mockResolvedValue([]);
      prisma.cnMedicineProduct.count.mockResolvedValue(0);

      await service.search({ q: 'aspirin', page: 1, pageSize: 10 });

      const findManyCall = prisma.cnMedicineProduct.findMany.mock.calls[0]?.[0];
      expect(findManyCall?.where).toHaveProperty('OR');
      // searchText is the primary discovery field; the business fields sit in
      // a nested fallback OR for rows with an empty searchText.
      expect(findManyCall?.where.OR).toHaveLength(2);
      expect(findManyCall?.where.OR[1]?.OR).toHaveLength(5);
    });

    it('returns empty where for empty query', async () => {
      prisma.cnMedicineProduct.findMany.mockResolvedValue([]);
      prisma.cnMedicineProduct.count.mockResolvedValue(0);

      await service.search({ q: '', page: 1, pageSize: 10 });

      const findManyCall = prisma.cnMedicineProduct.findMany.mock.calls[0]?.[0];
      expect(findManyCall?.where).toEqual({});
    });

    it('calculates skip correctly for pagination', async () => {
      prisma.cnMedicineProduct.findMany.mockResolvedValue([]);
      prisma.cnMedicineProduct.count.mockResolvedValue(0);

      await service.search({ q: 'test', page: 3, pageSize: 20 });

      const findManyCall = prisma.cnMedicineProduct.findMany.mock.calls[0]?.[0];
      expect(findManyCall?.skip).toBe(40);
      expect(findManyCall?.take).toBe(20);
    });
  });

  describe('getDetail', () => {
    it('returns null when medicine not found', async () => {
      prisma.cnMedicineProduct.findUnique.mockResolvedValue(null);

      const result = await service.getDetail('nonexistent');
      expect(result).toBeNull();
    });

    it('returns detail with cn source', async () => {
      const row = {
        ...makeRow(),
        leafletLinks: [{ leaflet: makeLeaflet() }],
      };
      prisma.cnMedicineProduct.findUnique.mockResolvedValue(row);

      const result = await service.getDetail('med-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('med-1');
      expect(result!.source).toBe('cn');
      expect(result!.name).toBe('阿司匹林');
      expect(result!.detail.kind).toBe('cnProduct');
      // body text comes from the linked leaflet, not the product row
      const detail = result!.detail as CnMedicineDetailDto;
      expect(detail.ingredients).toBe('阿司匹林');
      expect(detail.properties).toBe('白色片剂');
      expect(detail.indications).toBe('用于镇痛');
      expect(detail.storage).toBe('密封保存');
    });
  });
});
