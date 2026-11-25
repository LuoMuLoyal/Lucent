import type { AssistantToolExecutionContext } from '../../../../application/ports/assistant.js';
import type {
  IngredientReactionsView,
  OnsidesReactionsReader,
  ReactionDrugsView,
} from '../../../../../medicines/application/ports/onsides.js';
import { AssistantToolOnsidesService } from './onsides.service.js';

/**
 * The OnSIDES tool.
 *
 * Two things matter and are asserted here rather than left to the model:
 *
 * 1. **The direction decides the key.** A call naming the wrong key must say so,
 *    not come back empty — "no rows" and "you asked wrong" are different answers
 *    and only one of them is a fact about the drug.
 * 2. **The bridge gap is reported, not smoothed.** `by_drug` with no RxCUI is the
 *    normal case for 91.8% of DrugBank rows; the envelope has to say so, or the
 *    model reads it as "this drug has no adverse reactions".
 */
class FakeReader implements OnsidesReactionsReader {
  ingredient: IngredientReactionsView | null = null;
  byDrugbankId: IngredientReactionsView | null = null;
  reaction: ReactionDrugsView | null = null;
  calls: string[] = [];

  getByIngredient(rxnormCui: string): Promise<IngredientReactionsView | null> {
    this.calls.push(`ingredient:${rxnormCui}`);
    return Promise.resolve(this.ingredient);
  }

  getByDrugbankId(drugbankId: string): Promise<IngredientReactionsView | null> {
    this.calls.push(`drug:${drugbankId}`);
    return Promise.resolve(this.byDrugbankId);
  }

  getReactionDrugs(
    meddraId: string,
    limit: number,
  ): Promise<ReactionDrugsView | null> {
    this.calls.push(`reaction:${meddraId}:${String(limit)}`);
    return Promise.resolve(this.reaction);
  }
}

const ingredientView: IngredientReactionsView = {
  source: 'onsides',
  rxnormCui: '5640',
  sourceVersion: '2026-01',
  reactions: [
    {
      meddraId: '10028813',
      name: 'Nausea',
      termType: 'LLT',
      labelCount: 42,
      labelSections: ['AR', 'BW'],
      sources: ['US', 'EU'],
      confidenceMax: 4.2,
    },
    {
      meddraId: '10037844',
      name: 'Dizziness',
      termType: 'LLT',
      labelCount: 11,
      labelSections: ['AR'],
      sources: ['US'],
      confidenceMax: null,
    },
  ],
};

const reactionView: ReactionDrugsView = {
  source: 'onsides',
  meddraId: '10028813',
  meddraName: 'Nausea',
  drugs: [
    {
      drugbankId: 'DB01050',
      name: 'Ibuprofen',
      labelCount: 42,
      confidenceMax: 4.2,
    },
  ],
};

function context(args: Record<string, unknown>): AssistantToolExecutionContext {
  return {
    userId: 'user-1',
    locale: 'en',
    userMessage: 'what are the adverse reactions of ibuprofen',
    enabledContextSources: [],
    memoryEnabled: false,
    toolArgs: args,
  };
}

function build(reader: OnsidesReactionsReader): AssistantToolOnsidesService {
  return new AssistantToolOnsidesService(reader);
}

describe('AssistantToolOnsidesService', () => {
  it('reads by drug through the RxCUI bridge', async () => {
    const reader = new FakeReader();
    reader.byDrugbankId = ingredientView;

    const envelope = await build(reader).search(
      context({ direction: 'by_drug', drugbankId: 'DB01050' }),
    );

    expect(reader.calls).toEqual(['drug:DB01050']);
    expect(envelope.result).toMatchObject({
      direction: 'by_drug',
      drugbankId: 'DB01050',
      rxnormCui: '5640',
    });
    expect(envelope.coverage.status).toBe('complete');
  });

  it('reads by ingredient CUI', async () => {
    const reader = new FakeReader();
    reader.ingredient = ingredientView;

    const envelope = await build(reader).search(
      context({ direction: 'by_ingredient', rxnormCui: '5640' }),
    );

    expect(reader.calls).toEqual(['ingredient:5640']);
    expect(envelope.result).toMatchObject({ direction: 'by_ingredient' });
  });

  it('explains a missing bridge instead of reporting no reactions', async () => {
    const reader = new FakeReader();
    reader.byDrugbankId = null;

    const envelope = await build(reader).search(
      context({ direction: 'by_drug', drugbankId: 'DB99999' }),
    );

    // The single most dangerous misreading of this tool: an empty list is not
    // "this drug is safe", it is almost always "no RxCUI cross-reference".
    expect(envelope.coverage.status).toBe('empty');
    expect(String(envelope.coverage.reason)).toContain(
      'RxNorm ingredient cross-reference',
    );
  });

  it('reads by reaction and passes the clamped limit through', async () => {
    const reader = new FakeReader();
    reader.reaction = reactionView;

    const envelope = await build(reader).search(
      context({ direction: 'by_reaction', meddraId: '10028813', limit: 500 }),
    );

    // 500 is above MAX_REACTION_DRUG_LIMIT; the reader must never see it.
    expect(reader.calls).toEqual(['reaction:10028813:200']);
    expect(envelope.result).toMatchObject({ direction: 'by_reaction' });
  });

  it('reports an unknown MedDRA term as empty rather than as a drug-less answer', async () => {
    const reader = new FakeReader();
    reader.reaction = null;

    const envelope = await build(reader).search(
      context({ direction: 'by_reaction', meddraId: '999' }),
    );

    expect(envelope.coverage.status).toBe('empty');
    expect(String(envelope.coverage.reason)).toContain('Unknown MedDRA');
  });

  it('names the missing key when a direction was given without it', async () => {
    const reader = new FakeReader();

    const envelope = await build(reader).search(
      context({ direction: 'by_drug' }),
    );

    expect(envelope.coverage.status).toBe('empty');
    expect(String(envelope.coverage.reason)).toContain('drugbankId');
    expect(reader.calls).toEqual([]);
  });

  it('names the argument when direction is missing', async () => {
    const reader = new FakeReader();

    const envelope = await build(reader).search(context({}));

    expect(String(envelope.coverage.reason)).toContain('direction');
    expect(reader.calls).toEqual([]);
  });

  it('truncates to the limit and marks the result partial', async () => {
    const reader = new FakeReader();
    reader.ingredient = ingredientView;

    const envelope = await build(reader).search(
      context({ direction: 'by_ingredient', rxnormCui: '5640', limit: 1 }),
    );

    expect(envelope.coverage.status).toBe('partial');
    const result = envelope.result as { reactions: unknown[] };
    expect(result.reactions).toHaveLength(1);
  });
});
