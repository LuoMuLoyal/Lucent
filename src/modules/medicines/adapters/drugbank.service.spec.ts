import type { DeepMocked } from '../../../common/types/deep-mocked.js';

import { DrugbankMedicinesService } from './drugbank.service.js';
import type { PrismaService } from '../../../prisma/index.js';

describe('DrugbankMedicinesService', () => {
  let service: DrugbankMedicinesService;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      drugbankDrug: {
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
      },
      drugbankDrugSequence: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      drugbankTargetSequence: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
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
      targetRelations: [],
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

    it('queries by drugbankId and eagerly loads target relations', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(makeRow());

      await service.getDetail('DB00945');

      expect(prisma.drugbankDrug.findUnique).toHaveBeenCalledWith({
        where: { drugbankId: 'DB00945' },
        include: {
          targetRelations: {
            include: { target: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    });

    it('maps drug→target edges into the target list', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(
        makeRow({
          targetRelations: [
            {
              targetId: 'target-1',
              relationKind: 'target',
              actions: ['inhibitor'],
              knownAction: 'yes',
              target: {
                name: 'Prostaglandin G/H synthase 1',
                geneName: 'PTGS1',
                uniprotId: 'P23219',
                uniprotTitle: 'PGH1_HUMAN',
                species: 'Humans',
                pdbIds: ['1CQE', '1EQG'],
              },
            },
          ],
        }),
      );

      const result = await service.getDetail('DB00945');
      const detail = result?.detail as { targets: unknown[] };

      expect(detail.targets).toEqual([
        {
          name: 'Prostaglandin G/H synthase 1',
          geneName: 'PTGS1',
          uniprotId: 'P23219',
          uniprotTitle: 'PGH1_HUMAN',
          species: 'Humans',
          pdbIds: ['1CQE', '1EQG'],
          actions: ['inhibitor'],
          knownAction: 'yes',
          relationKind: 'target',
        },
      ]);
    });

    it('drops the CSV duplicate when the XML described the same pair', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(
        makeRow({
          targetRelations: [
            {
              targetId: 'target-1',
              relationKind: 'all',
              actions: null,
              knownAction: null,
              target: { name: 'Cyclooxygenase-1', geneName: 'PTGS1' },
            },
            {
              targetId: 'target-1',
              relationKind: 'target',
              actions: ['inhibitor'],
              knownAction: 'yes',
              target: { name: 'Cyclooxygenase-1', geneName: 'PTGS1' },
            },
          ],
        }),
      );

      const result = await service.getDetail('DB00945');
      const detail = result?.detail as { targets: { relationKind: string }[] };

      // Only the XML row survives: the CSV row had no actions and no
      // relationship typing.
      expect(detail.targets).toHaveLength(1);
      expect(detail.targets[0]!.relationKind).toBe('target');
    });

    it('keeps a CSV-only target the XML never mentioned', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(
        makeRow({
          targetRelations: [
            {
              targetId: 'target-csv-only',
              relationKind: 'all',
              actions: null,
              knownAction: null,
              target: { name: 'Serum albumin', geneName: 'ALB' },
            },
            {
              targetId: 'target-1',
              relationKind: 'target',
              actions: ['inhibitor'],
              knownAction: 'yes',
              target: { name: 'Cyclooxygenase-1', geneName: 'PTGS1' },
            },
          ],
        }),
      );

      const result = await service.getDetail('DB00945');
      const detail = result?.detail as { targets: { name: string }[] };

      expect(detail.targets.map((target) => target.name)).toEqual([
        'Serum albumin',
        'Cyclooxygenase-1',
      ]);
    });

    it('keeps one entry per relationship kind for the same target', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(
        makeRow({
          targetRelations: [
            {
              targetId: 'target-1',
              relationKind: 'target',
              actions: ['inhibitor'],
              knownAction: 'yes',
              target: { name: 'Cyclooxygenase-1', geneName: 'PTGS1' },
            },
            {
              targetId: 'target-1',
              relationKind: 'enzyme',
              actions: ['substrate'],
              knownAction: 'yes',
              target: { name: 'Cyclooxygenase-1', geneName: 'PTGS1' },
            },
          ],
        }),
      );

      const result = await service.getDetail('DB00945');
      const detail = result?.detail as { targets: { relationKind: string }[] };

      // Each edge carries its own actions, so neither may be collapsed away.
      expect(detail.targets.map((target) => target.relationKind)).toEqual([
        'target',
        'enzyme',
      ]);
    });

    it('returns null targets when there are no edges', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(makeRow());

      const result = await service.getDetail('DB00945');
      const detail = result?.detail as { targets: unknown };

      expect(detail.targets).toBeNull();
    });

    it('maps typed external identifiers and links', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(
        makeRow({
          externalIdentifiers: [
            { resource: 'PubChem Compound', identifier: '2244' },
            { resource: 'broken' },
          ],
          externalLinks: [
            {
              resource: 'Drugs.com',
              url: 'https://www.drugs.com/aspirin.html',
            },
          ],
        }),
      );

      const result = await service.getDetail('DB00945');
      const detail = result?.detail as {
        externalIdentifiers: unknown;
        externalLinks: unknown;
      };

      // The half-populated entry is dropped rather than surfacing a blank row.
      expect(detail.externalIdentifiers).toEqual([
        { resource: 'PubChem Compound', identifier: '2244' },
      ]);
      expect(detail.externalLinks).toEqual([
        { resource: 'Drugs.com', url: 'https://www.drugs.com/aspirin.html' },
      ]);
    });

    it('reports sequence counts without loading any sequence text', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(
        makeRow({
          targetRelations: [
            {
              targetId: 'target-1',
              relationKind: 'target',
              actions: null,
              knownAction: null,
              target: { name: 'COX-1', uniprotId: 'P23219' },
            },
          ],
        }),
      );
      prisma.drugbankDrugSequence.count.mockResolvedValue(2);
      prisma.drugbankTargetSequence.count.mockResolvedValue(2);

      const result = await service.getDetail('DB00945');
      const detail = result?.detail as {
        sequenceSummary: {
          drugChainCount: number;
          targetSequenceCount: number;
        };
      };

      expect(detail.sequenceSummary).toEqual({
        drugChainCount: 2,
        targetSequenceCount: 2,
      });
      // The summary must not drag the sequences themselves along.
      expect(prisma.drugbankDrugSequence.findMany).not.toHaveBeenCalled();
      expect(prisma.drugbankTargetSequence.findMany).not.toHaveBeenCalled();
    });

    it('omits the sequence summary when the drug has none', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(makeRow());

      const result = await service.getDetail('DB00945');
      const detail = result?.detail as { sequenceSummary: unknown };

      expect(detail.sequenceSummary).toBeNull();
    });
  });

  describe('getSequences', () => {
    it('returns null for an unknown drug', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(null);

      await expect(service.getSequences('DB99999')).resolves.toBeNull();
    });

    it('returns the drug chains and its targets sequences', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(
        makeRow({
          drugbankId: 'DB00002',
          targetRelations: [
            {
              targetId: 'target-1',
              target: { uniprotId: 'P00519' },
            },
          ],
        }),
      );
      prisma.drugbankDrugSequence.findMany.mockResolvedValue([
        { description: 'heavy chain', length: 449, sequence: 'QVQLK' },
        { description: 'light chain', length: 214, sequence: 'DILLT' },
      ]);
      prisma.drugbankTargetSequence.findMany.mockResolvedValue([
        {
          uniprotId: 'P00519',
          targetName: 'ABL1',
          sourceDataset: 'protein_fasta',
          length: 1130,
          sequence: 'MLEIC',
        },
        {
          uniprotId: 'P00519',
          targetName: 'ABL1',
          sourceDataset: 'gene_fasta',
          length: 3393,
          sequence: 'ATGCT',
        },
      ]);

      const result = await service.getSequences('DB00002');

      expect(result?.source).toBe('drugbank');
      expect(result?.drug).toEqual([
        { description: 'heavy chain', length: 449, sequence: 'QVQLK' },
        { description: 'light chain', length: 214, sequence: 'DILLT' },
      ]);
      expect(result?.targets).toEqual([
        {
          uniprotId: 'P00519',
          targetName: 'ABL1',
          dataset: 'protein_fasta',
          length: 1130,
          sequence: 'MLEIC',
        },
        {
          uniprotId: 'P00519',
          targetName: 'ABL1',
          dataset: 'gene_fasta',
          length: 3393,
          sequence: 'ATGCT',
        },
      ]);
    });

    it('deduplicates UniProt ids shared by several targets', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(
        makeRow({
          targetRelations: [
            { targetId: 't1', target: { uniprotId: 'P00519' } },
            // Same protein reached through a different relationship kind.
            { targetId: 't2', target: { uniprotId: 'P00519' } },
            { targetId: 't3', target: { uniprotId: null } },
          ],
        }),
      );

      await service.getSequences('DB00945');

      expect(prisma.drugbankTargetSequence.findMany).toHaveBeenCalledWith({
        where: { uniprotId: { in: ['P00519'] } },
        orderBy: [{ uniprotId: 'asc' }, { sourceDataset: 'asc' }],
      });
    });

    it('skips the target query when no target has a UniProt id', async () => {
      prisma.drugbankDrug.findUnique.mockResolvedValue(
        makeRow({
          targetRelations: [{ targetId: 't1', target: { uniprotId: null } }],
        }),
      );

      const result = await service.getSequences('DB00945');

      expect(prisma.drugbankTargetSequence.findMany).not.toHaveBeenCalled();
      expect(result?.targets).toEqual([]);
    });
  });
});
