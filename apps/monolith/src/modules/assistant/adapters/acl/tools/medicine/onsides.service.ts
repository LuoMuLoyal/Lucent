import { Inject, Injectable } from '@nestjs/common';
import type {
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../../../application/ports/assistant.js';
import {
  DEFAULT_REACTION_DRUG_LIMIT,
  MAX_REACTION_DRUG_LIMIT,
  ONSIDES_REACTIONS_READER,
  type IngredientReactionsView,
  type OnsidesReactionsReader,
  type ReactionDrugsView,
} from '../../../../../medicines/application/ports/onsides.js';
import { readString } from './lookup-payload.js';
import {
  buildReadConfidence,
  buildReadEnvelope,
} from '../../../http/presenters/proposal.js';

/**
 * OnSIDES adverse-reaction lookup for the assistant and MCP.
 *
 * ## One tool, three directions
 *
 * The HTTP surface has three endpoints because each is a different resource. The
 * assistant gets **one** tool (`search_adverse_reactions`) with a `direction`
 * argument instead, for a reason that is about the model, not the storage: a
 * model with three near-identical tools picks the wrong one routinely, and the
 * three directions answer one question — "what does the label evidence say about
 * this substance's adverse reactions". The discriminator is explicit and
 * required, so an ambiguous call is a validation error rather than a guess.
 *
 * | direction | key | answers |
 * | --- | --- | --- |
 * | `by_drug` | `drugbankId` | what this drug's labels state |
 * | `by_ingredient` | `rxnormCui` | what this ingredient's labels state |
 * | `by_reaction` | `meddraId` | which drugs' labels state this reaction |
 *
 * ## What the envelope says
 *
 * OnSIDES facts are **label-stated**, never observed incidence, and its weakest
 * link is the RxCUI bridge (8.2% of DrugBank rows at drug level). Both facts go
 * into `coverage` rather than being smoothed over: an empty `by_drug` result is
 * "no bridge or no statements", not "this drug is safe", and the model must be
 * able to see that difference in the returned data.
 */
@Injectable()
export class AssistantToolOnsidesService {
  constructor(
    @Inject(ONSIDES_REACTIONS_READER)
    private readonly reader: OnsidesReactionsReader,
  ) {}

  async search(
    ctx: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const args = ctx.toolArgs ?? {};
    const direction = readString(args['direction']);
    const limit = normalizeLimit(args['limit']);

    switch (direction) {
      case 'by_drug':
        return this.byDrug(readString(args['drugbankId']), limit);
      case 'by_ingredient':
        return this.byIngredient(readString(args['rxnormCui']), limit);
      case 'by_reaction':
        return this.byReaction(readString(args['meddraId']), limit);
      default:
        // The schema requires `direction`, so reaching here means the caller
        // bypassed validation (a direct ACL call or a stale MCP client). Answer
        // with an empty envelope naming what was missing instead of guessing.
        return buildReadEnvelope({
          toolName: 'search_adverse_reactions',
          query: { query: ctx.userMessage, matchedSource: 'onsides' },
          result: { direction: null, ingredient: null, reaction: null },
          coverage: {
            status: 'empty',
            reason:
              'Missing or unknown `direction`: pass one of by_drug, by_ingredient, by_reaction.',
          },
          timeRange: { timezone: 'UTC', startDate: null, endDate: null },
          confidence: { level: 'low', reason: 'No usable query direction.' },
          ambiguities: [],
          tables: ['onsides_ingredient_adverse_effects'],
        });
    }
  }

  private async byDrug(
    drugbankId: string | null,
    limit: number,
  ): Promise<AssistantReadResultEnvelope> {
    if (drugbankId == null) {
      return this.emptyFor(
        'by_drug',
        '`drugbankId` is required for direction=by_drug.',
        'onsides_ingredient_adverse_effects',
      );
    }

    const view = await this.reader.getByDrugbankId(drugbankId);
    if (view == null) {
      // The bridge is the interesting failure here, and it is normal: 91.8% of
      // DrugBank rows have no RxCUI. Saying so prevents the model from reporting
      // "no adverse reactions" for a drug nobody looked up.
      return buildReadEnvelope({
        toolName: 'search_adverse_reactions',
        query: {
          query: drugbankId,
          matchedSource: 'onsides',
          direction: 'by_drug',
        },
        result: { direction: 'by_drug', drugbankId, reactions: [] },
        coverage: {
          status: 'empty',
          reason: `No RxNorm ingredient cross-reference for "${drugbankId}", or that ingredient has no label-stated reactions.`,
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        confidence: {
          level: 'low',
          reason: 'The RxCUI bridge covered 8.2% of DrugBank rows at import.',
        },
        ambiguities: [],
        tables: [
          'drugbank_external_identifiers',
          'onsides_ingredient_adverse_effects',
        ],
      });
    }

    return this.fromIngredient('by_drug', view, limit, {
      drugbankId,
    });
  }

  private async byIngredient(
    rxnormCui: string | null,
    limit: number,
  ): Promise<AssistantReadResultEnvelope> {
    if (rxnormCui == null) {
      return this.emptyFor(
        'by_ingredient',
        '`rxnormCui` is required for direction=by_ingredient.',
        'onsides_ingredient_adverse_effects',
      );
    }

    const view = await this.reader.getByIngredient(rxnormCui);
    if (view == null) {
      return this.emptyFor(
        'by_ingredient',
        `No label-stated reactions for RxNorm ingredient CUI "${rxnormCui}".`,
        'onsides_ingredient_adverse_effects',
        { rxnormCui },
      );
    }

    return this.fromIngredient('by_ingredient', view, limit, { rxnormCui });
  }

  private async byReaction(
    meddraId: string | null,
    limit: number,
  ): Promise<AssistantReadResultEnvelope> {
    if (meddraId == null) {
      return this.emptyFor(
        'by_reaction',
        '`meddraId` is required for direction=by_reaction.',
        'onsides_ingredient_adverse_effects',
      );
    }

    const view = await this.reader.getReactionDrugs(meddraId, limit);
    if (view == null) {
      return this.emptyFor(
        'by_reaction',
        `Unknown MedDRA term id "${meddraId}".`,
        'onsides_adverse_reactions',
        { meddraId },
      );
    }

    return this.fromReaction(view, limit);
  }

  /**
   * Ingredient-direction envelope, shared by `by_drug` and `by_ingredient`.
   *
   * The two differ only in how the CUI was obtained; the evidence and its
   * caveats are identical, so the envelope shape is too.
   */
  private fromIngredient(
    direction: 'by_drug' | 'by_ingredient',
    view: IngredientReactionsView,
    limit: number,
    identity: Record<string, unknown>,
  ): AssistantReadResultEnvelope {
    const reactions = view.reactions.slice(0, limit);
    const truncated = view.reactions.length > reactions.length;

    return buildReadEnvelope({
      toolName: 'search_adverse_reactions',
      query: {
        query:
          typeof identity['drugbankId'] === 'string'
            ? identity['drugbankId']
            : identity['rxnormCui'],
        matchedSource: 'onsides',
        direction,
        ...identity,
        limit,
      },
      result: {
        direction,
        ...identity,
        rxnormCui: view.rxnormCui,
        sourceVersion: view.sourceVersion,
        reactions,
      },
      coverage: {
        status: truncated ? 'partial' : 'complete',
        reason: truncated
          ? `Showing the ${String(reactions.length)} strongest of ${String(view.reactions.length)} label-stated reactions.`
          : null,
      },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities: [],
        preferredReason:
          'Loaded label-stated adverse reactions from the OnSIDES tables.',
      }),
      ambiguities: [],
      tables: [
        'onsides_ingredient_adverse_effects',
        'onsides_adverse_reactions',
      ],
    });
  }

  private fromReaction(
    view: ReactionDrugsView,
    limit: number,
  ): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'search_adverse_reactions',
      query: {
        query: view.meddraId,
        matchedSource: 'onsides',
        direction: 'by_reaction',
        meddraId: view.meddraId,
        limit,
      },
      result: {
        direction: 'by_reaction',
        meddraId: view.meddraId,
        meddraName: view.meddraName,
        drugs: view.drugs,
      },
      coverage: {
        status: view.drugs.length === 0 ? 'empty' : 'complete',
        reason:
          view.drugs.length === 0
            ? 'No ingredient states this reaction in the loaded OnSIDES data.'
            : null,
      },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: buildReadConfidence({
        ambiguities: [],
        preferredReason:
          'Derived from label-stated OnSIDES pairs, deduplicated by drug.',
      }),
      ambiguities: [],
      tables: [
        'onsides_ingredient_adverse_effects',
        'drugbank_external_identifiers',
      ],
    });
  }

  /** Empty envelope naming the argument a direction needed. */
  private emptyFor(
    direction: 'by_drug' | 'by_ingredient' | 'by_reaction',
    reason: string,
    table: string,
    identity: Record<string, unknown> = {},
  ): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'search_adverse_reactions',
      query: {
        query: identity['rxnormCui'] ?? identity['meddraId'] ?? '',
        matchedSource: 'onsides',
        direction,
        ...identity,
      },
      result: { direction: direction, reactions: [], drugs: [] },
      coverage: { status: 'empty', reason },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: { level: 'low', reason },
      ambiguities: [],
      tables: [table],
    });
  }
}

/** Clamps the model's `limit` into the range the reader accepts. */
function normalizeLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_REACTION_DRUG_LIMIT;
  }
  const value = Math.trunc(raw);
  if (value < 1) return 1;
  return Math.min(value, MAX_REACTION_DRUG_LIMIT);
}
