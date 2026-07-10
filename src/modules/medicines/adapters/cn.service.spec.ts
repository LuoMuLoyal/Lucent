/* eslint-disable @typescript-eslint/no-unsafe-call */
import { CnMedicinesService } from './cn.service';
import type { PrismaService } from '../../../prisma/prisma.service';

describe('CnMedicinesService', () => {
  let service: CnMedicinesService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      cnMedicineProduct: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

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
      ingredients: '阿司匹林',
      properties: '白色片剂',
      indications: '用于镇痛',
      dosage: '口服',
      adverseReactions: '胃肠道不适',
      contraindications: '对本品过敏者禁用',
      precautions: '孕妇慎用',
      pharmacologyToxicology: null,
      drugInteractions: null,
      pharmacokinetics: null,
      overdose: null,
      storage: '密封保存',
      validityPeriod: '36个月',
      sourceUrl: 'https://example.com/source',
      drugbankIds: ['DB00945'],
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

    it('builds where clause with OR conditions for query', async () => {
      prisma.cnMedicineProduct.findMany.mockResolvedValue([]);
      prisma.cnMedicineProduct.count.mockResolvedValue(0);

      await service.search({ q: 'aspirin', page: 1, pageSize: 10 });

      const findManyCall = prisma.cnMedicineProduct.findMany.mock.calls[0]?.[0];
      expect(findManyCall?.where).toHaveProperty('OR');
      expect(findManyCall?.where.OR).toHaveLength(6);
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
      prisma.cnMedicineProduct.findUnique.mockResolvedValue(makeRow());

      const result = await service.getDetail('med-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('med-1');
      expect(result!.source).toBe('cn');
      expect(result!.name).toBe('阿司匹林');
      expect(result!.detail.kind).toBe('cnProduct');
    });

    it('parses drugbankIds from array', async () => {
      prisma.cnMedicineProduct.findUnique.mockResolvedValue(
        makeRow({ drugbankIds: ['DB001', 'DB002'] }),
      );

      const result = await service.getDetail('med-1');
      expect(result!.detail.drugbankIds).toEqual(['DB001', 'DB002']);
    });

    it('returns null drugbankIds when value is null', async () => {
      prisma.cnMedicineProduct.findUnique.mockResolvedValue(
        makeRow({ drugbankIds: null }),
      );

      const result = await service.getDetail('med-1');
      expect(result!.detail.drugbankIds).toBeNull();
    });

    it('returns null drugbankIds when value is empty array', async () => {
      prisma.cnMedicineProduct.findUnique.mockResolvedValue(
        makeRow({ drugbankIds: [] }),
      );

      const result = await service.getDetail('med-1');
      expect(result!.detail.drugbankIds).toBeNull();
    });
  });
});
