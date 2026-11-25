import type { DeepMocked } from '../../../../common/types/deep-mocked.js';

import { PrismaOnsidesReactions } from './onsides.js';
import type { PrismaService } from '../../../../prisma/index.js';

/**
 * Two things in this adapter are easy to get wrong and are asserted here:
 *
 * 1. `confidenceMax` stays `null` when every hit was unscored — the source uses a
 *    zero for "no score", and a `0` here would read as "scored very low".
 * 2. One drug can bridge to several ingredient CUIs and one CUI to several drugs;
 *    the culprit list is keyed by drug, not by (drug, CUI) pair.
 */
describe('PrismaOnsidesReactions', () => {
  let service: PrismaOnsidesReactions;
  let prisma: DeepMocked<PrismaService>;

  const reaction = {
    id: 'reaction-uuid',
    meddraId: '10037844',
    meddraName: 'Rash',
    meddraTermType: 'LLT',
  };

  beforeEach(() => {
    prisma = {
      onsidesIngredientAdverseEffect: { findMany: vi.fn() },
      onsidesAdverseReaction: { findUnique: vi.fn() },
      drugbankExternalIdentifier: { findFirst: vi.fn(), findMany: vi.fn() },
    } as unknown as DeepMocked<PrismaService>;

    service = new PrismaOnsidesReactions(prisma);
  });

  describe('getByIngredient', () => {
    it('returns null when the ingredient has no rows', async () => {
      prisma.onsidesIngredientAdverseEffect.findMany.mockResolvedValue([]);

      await expect(service.getByIngredient('5640')).resolves.toBeNull();
    });

    it('orders sections AR-first and keeps an unscored pair null', async () => {
      prisma.onsidesIngredientAdverseEffect.findMany.mockResolvedValue([
        {
          reaction,
          labelCount: 7,
          // Deliberately out of order and with an unknown extra section.
          labelSections: ['WP', 'AR', 'ZZ'],
          sources: ['JP', 'US'],
          confidenceMax: null,
          sourceVersion: 'v3.1.1',
        },
      ] as never);

      const view = await service.getByIngredient('5640');

      expect(view?.reactions[0]).toEqual({
        meddraId: '10037844',
        name: 'Rash',
        termType: 'LLT',
        labelCount: 7,
        labelSections: ['AR', 'WP', 'ZZ'],
        sources: ['JP', 'US'],
        confidenceMax: null,
      });
      expect(view?.sourceVersion).toBe('v3.1.1');
    });
  });

  describe('getByDrugbankId', () => {
    it('returns null when the drug has no RxCUI bridge', async () => {
      prisma.drugbankExternalIdentifier.findFirst.mockResolvedValue(null);

      await expect(service.getByDrugbankId('DB00001')).resolves.toBeNull();
      expect(
        prisma.onsidesIngredientAdverseEffect.findMany,
      ).not.toHaveBeenCalled();
    });

    it('bridges through the RxCUI identifier', async () => {
      prisma.drugbankExternalIdentifier.findFirst.mockResolvedValue({
        identifier: '5640',
      } as never);
      prisma.onsidesIngredientAdverseEffect.findMany.mockResolvedValue([
        {
          reaction,
          labelCount: 2,
          labelSections: ['AR'],
          sources: ['US'],
          confidenceMax: 5.74,
          sourceVersion: 'v3.1.1',
        },
      ] as never);

      const view = await service.getByDrugbankId('DB01050');

      expect(view?.rxnormCui).toBe('5640');
      expect(view?.reactions).toHaveLength(1);
      expect(prisma.drugbankExternalIdentifier.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { drugbankId: 'DB01050', resource: 'RxCUI' },
        }),
      );
    });
  });

  describe('getReactionDrugs', () => {
    it('returns null for an unknown MedDRA term', async () => {
      prisma.onsidesAdverseReaction.findUnique.mockResolvedValue(null);

      await expect(service.getReactionDrugs('999', 50)).resolves.toBeNull();
    });

    it('returns an empty list when the term exists but has no pairs', async () => {
      prisma.onsidesAdverseReaction.findUnique.mockResolvedValue(reaction);
      prisma.onsidesIngredientAdverseEffect.findMany.mockResolvedValue([]);

      const view = await service.getReactionDrugs('10037844', 50);

      expect(view).toEqual({
        source: 'onsides',
        meddraId: '10037844',
        meddraName: 'Rash',
        drugs: [],
      });
    });

    it('merges the same drug reached through several ingredient CUIs', async () => {
      prisma.onsidesAdverseReaction.findUnique.mockResolvedValue(reaction);
      prisma.onsidesIngredientAdverseEffect.findMany.mockResolvedValue([
        { rxnormCui: '5640', labelCount: 3, confidenceMax: 4.2 },
        { rxnormCui: '2000', labelCount: 1, confidenceMax: 5.9 },
      ] as never);
      prisma.drugbankExternalIdentifier.findMany.mockResolvedValue([
        {
          identifier: '5640',
          drugbankId: 'DB01050',
          drug: { name: 'Ibuprofen' },
        },
        // Same drug, second CUI: the counts must add up, the confidence must max.
        {
          identifier: '2000',
          drugbankId: 'DB01050',
          drug: { name: 'Ibuprofen' },
        },
      ] as never);

      const view = await service.getReactionDrugs('10037844', 50);

      expect(view?.drugs).toHaveLength(1);
      expect(view?.drugs[0]).toEqual({
        drugbankId: 'DB01050',
        name: 'Ibuprofen',
        labelCount: 4,
        confidenceMax: 5.9,
      });
    });

    it('keeps an unscored culprit null rather than zero', async () => {
      prisma.onsidesAdverseReaction.findUnique.mockResolvedValue(reaction);
      prisma.onsidesIngredientAdverseEffect.findMany.mockResolvedValue([
        { rxnormCui: '5640', labelCount: 2, confidenceMax: null },
      ] as never);
      prisma.drugbankExternalIdentifier.findMany.mockResolvedValue([
        {
          identifier: '5640',
          drugbankId: 'DB01050',
          drug: { name: 'Ibuprofen' },
        },
      ] as never);

      const view = await service.getReactionDrugs('10037844', 50);

      expect(view?.drugs[0]?.confidenceMax).toBeNull();
    });
  });
});
