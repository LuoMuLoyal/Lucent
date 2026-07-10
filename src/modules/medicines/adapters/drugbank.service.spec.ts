import type { DeepMocked } from '../../../common/types/deep-mocked';

import { DrugbankMedicinesService } from './drugbank.service';
import type { PrismaService } from '../../../prisma/prisma.service';

describe('DrugbankMedicinesService', () => {
  let service: DrugbankMedicinesService;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      drugbankDrug: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
    } as unknown as DeepMocked<PrismaService>;

    service = new DrugbankMedicinesService(prisma);
  });

  function makeRow(overrides: Record<string, unknown> = {}) {
    return {
      drugbankId: 'DB00945',
      name: 'Aspirin',
      casNumber: '50-78-2',
      unii: 'R16CO5Y76E',
      searchText: 'Aspirin acetylsalicylic acid',
      drugType: 'small_molecule',
      state: 'solid',
      description: 'An anti-inflammatory drug',
      indication: 'For pain relief',
      mechanismOfAction: 'Inhibits COX',
      pharmacodynamics: null,
      toxicity: null,
      metabolism: null,
      absorption: null,
      halfLife: null,
      proteinBinding: null,
      routeOfElimination: null,
      volumeOfDistribution: null,
      clearance: null,
      groups: ['approved'],
      categories: ['Analgesics'],
      atcCodes: ['A01AD05'],
      synonyms: ['Acetylsalicylic acid'],
      foodInteractions: null,
      drugInteractions: null,
      externalIdentifiers: null,
      externalLinks: null,
      ...overrides,
    };
  }

  describe('search', () => {
    it('returns paginated search results', async () => {
      const rows = [makeRow()];
      prisma.drugbankDrug.findMany.mockResolvedValue(rows);
      prisma.drugbankDrug.count.mockResolvedValue(1);

      const result = await service.search({
        q: 'aspirin',
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('DB00945');
      expect(result.items[0]!.source).toBe('drugbank');
      expect(result.items[0]!.name).toBe('Aspirin');
      expect(result.pagination).toBeDefined();
    });

    it('builds where clause with OR conditions for query', async () => {
      prisma.drugbankDrug.findMany.mockResolvedValue([]);
      prisma.drugbankDrug.count.mockResolvedValue(0);

      await service.search({ q: 'aspirin', page: 1, pageSize: 10 });

      const findManyCall = prisma.drugbankDrug.findMany.mock.calls[0]?.[0];
      expect(findManyCall?.where).toHaveProperty('OR');
      expect(findManyCall?.where.OR).toHaveLength(4);
    });

    it('returns empty where for empty query', async () => {
      prisma.drugbankDrug.findMany.mockResolvedValue([]);
      prisma.drugbankDrug.count.mockResolvedValue(0);

      await service.search({ q: '', page: 1, pageSize: 10 });

      const findManyCall = prisma.drugbankDrug.findMany.mock.calls[0]?.[0];
      expect(findManyCall?.where).toEqual({});
    });

    it('imageUrl is always null for drugbank items', async () => {
      prisma.drugbankDrug.findMany.mockResolvedValue([makeRow()]);
      prisma.drugbankDrug.count.mockResolvedValue(1);

      const result = await service.search({
        q: 'aspirin',
        page: 1,
        pageSize: 10,
      });

      expect(result.items[0]!.imageUrl).toBeNull();
    });
  });

  describe('getDetail', () => {
    it('returns null when medicine not found', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(null);

      const result = await service.getDetail('DB99999');
      expect(result).toBeNull();
    });

    it('returns detail with drugbank source', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(makeRow());

      const result = await service.getDetail('DB00945');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('DB00945');
      expect(result!.source).toBe('drugbank');
      expect(result!.name).toBe('Aspirin');
      expect(result!.detail.kind).toBe('drugbank');
    });

    it('converts JSONB fields to string arrays', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(
        makeRow({
          groups: ['approved', 'investigational'],
          categories: ['Analgesics', 'Anti-inflammatory'],
          atcCodes: ['A01AD05', 'N02BA01'],
          synonyms: ['ASA', '2-acetoxybenzoic acid'],
          foodInteractions: ['Take with food'],
        }),
      );

      const result = await service.getDetail('DB00945');
      const detail = result!.detail as unknown as Record<string, unknown>;
      expect(detail['groups']).toEqual(['approved', 'investigational']);
      expect(detail['categories']).toEqual(['Analgesics', 'Anti-inflammatory']);
      expect(detail['synonyms']).toEqual(['ASA', '2-acetoxybenzoic acid']);
    });

    it('handles null JSONB fields as empty arrays', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(
        makeRow({ groups: null, categories: null, synonyms: null }),
      );

      const result = await service.getDetail('DB00945');
      const detail = result!.detail as unknown as Record<string, unknown>;
      expect(detail['groups']).toEqual([]);
      expect(detail['categories']).toEqual([]);
      expect(detail['synonyms']).toEqual([]);
    });

    it('queries by drugbankId', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(makeRow());

      await service.getDetail('DB00945');

      expect(prisma.drugbankDrug.findUnique).toHaveBeenCalledWith({
        where: { drugbankId: 'DB00945' },
      });
    });
  });
});
