/**
 * OnSIDES persistence (`infrastructure/persistence`).
 *
 * Two queries that matter, both two hops:
 *
 *   drug → RxCUI → ingredient pair → MedDRA term        (reactions for a drug)
 *   reaction → pair → RxCUI → drugbank_external_identifiers → drug  (culprits)
 *
 * Both go through `drugbank_external_identifiers` because that table is the only
 * existing bridge between our drug rows and OnSIDES' RxNorm CUI space. Measured
 * pairing coverage is 92.62%; the gap is a granularity mismatch in DrugBank's own
 * RxCUI values (some are ingredient CUIs, some clinical-drug CUIs), not a defect
 * of this query.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../prisma/index.js';

import {
  type IngredientReaction,
  type IngredientReactionsView,
  type OnsidesReactionsReader,
  type ReactionDrugsView,
} from '../../application/ports/onsides.js';

/** AR first: it is the section that actually reads as "adverse reactions". */
const SECTION_ORDER = ['AR', 'BW', 'WP', 'NA'];

function orderSections(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
  const known = SECTION_ORDER.filter((section) => raw.includes(section));
  const rest = raw
    .filter((section) => !SECTION_ORDER.includes(section))
    .sort((a, b) => a.localeCompare(b));
  return [...known, ...rest];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

@Injectable()
export class PrismaOnsidesReactions implements OnsidesReactionsReader {
  constructor(private readonly prisma: PrismaService) {}

  async getByIngredient(
    rxnormCui: string,
  ): Promise<IngredientReactionsView | null> {
    const rows = await this.prisma.onsidesIngredientAdverseEffect.findMany({
      where: { rxnormCui },
      include: { reaction: true },
      // Highest confidence first: the whole point of carrying a score is so the
      // client can show the strongest evidence without fetching everything.
      orderBy: [{ confidenceMax: 'desc' }, { labelCount: 'desc' }],
    });

    if (rows.length === 0) {
      return null;
    }

    return {
      source: 'onsides',
      rxnormCui,
      sourceVersion: rows[0]?.sourceVersion ?? '',
      reactions: rows.map((row) => this.toReaction(row)),
    };
  }

  async getByDrugbankId(
    drugbankId: string,
  ): Promise<IngredientReactionsView | null> {
    const rxnormCui = await this.resolveIngredientCui(drugbankId);
    if (rxnormCui === null) {
      return null;
    }
    return this.getByIngredient(rxnormCui);
  }

  async getReactionDrugs(
    meddraId: string,
    limit: number,
  ): Promise<ReactionDrugsView | null> {
    const reaction = await this.prisma.onsidesAdverseReaction.findUnique({
      where: { meddraId },
      select: { meddraId: true, meddraName: true, id: true },
    });

    if (!reaction) {
      return null;
    }

    const pairs = await this.prisma.onsidesIngredientAdverseEffect.findMany({
      where: { reactionId: reaction.id },
      orderBy: [{ confidenceMax: 'desc' }, { labelCount: 'desc' }],
      take: limit,
      select: {
        rxnormCui: true,
        labelCount: true,
        confidenceMax: true,
      },
    });

    if (pairs.length === 0) {
      return {
        source: 'onsides',
        meddraId: reaction.meddraId,
        meddraName: reaction.meddraName,
        drugs: [],
      };
    }

    const bridges = await this.prisma.drugbankExternalIdentifier.findMany({
      where: {
        resource: 'RxCUI',
        identifier: { in: pairs.map((pair) => pair.rxnormCui) },
      },
      select: {
        identifier: true,
        drugbankId: true,
        drug: { select: { name: true } },
      },
    });

    // One ingredient CUI can bridge to several DrugBank rows (salt forms,
    // combination products), and one drug can appear through several CUIs. Keyed
    // by drug id and keeping the strongest evidence, because the answer the caller
    // wants is "which drugs", not "which (drug, CUI) pairs".
    const byDrug = new Map<string, ReactionDrugsView['drugs'][number]>();
    for (const bridge of bridges) {
      const pair = pairs.find((item) => item.rxnormCui === bridge.identifier);
      if (!pair) {
        continue;
      }
      const existing = byDrug.get(bridge.drugbankId);
      const labelCount = (existing?.labelCount ?? 0) + pair.labelCount;
      const confidenceMax = Math.max(
        existing?.confidenceMax ?? Number.NEGATIVE_INFINITY,
        pair.confidenceMax ?? Number.NEGATIVE_INFINITY,
      );
      byDrug.set(bridge.drugbankId, {
        drugbankId: bridge.drugbankId,
        name: bridge.drug.name,
        labelCount,
        confidenceMax: Number.isFinite(confidenceMax) ? confidenceMax : null,
      });
    }

    return {
      source: 'onsides',
      meddraId: reaction.meddraId,
      meddraName: reaction.meddraName,
      drugs: [...byDrug.values()].sort((a, b) => b.labelCount - a.labelCount),
    };
  }

  /**
   * DrugBank id → RxNorm ingredient CUI.
   *
   * The bridge column is free-form (`resource` covers a long tail of registries),
   * so the resource label is matched exactly rather than by pattern. A drug with
   * several RxCUI rows takes the first one in identifier order: the alternates are
   * salt forms of the same ingredient and share the reaction set.
   */
  private async resolveIngredientCui(
    drugbankId: string,
  ): Promise<string | null> {
    const bridge = await this.prisma.drugbankExternalIdentifier.findFirst({
      where: { drugbankId, resource: 'RxCUI' },
      orderBy: { identifier: 'asc' },
      select: { identifier: true },
    });

    return bridge?.identifier ?? null;
  }

  private toReaction(row: {
    reaction: { meddraId: string; meddraName: string; meddraTermType: string };
    labelCount: number;
    labelSections: unknown;
    sources: unknown;
    confidenceMax: number | null;
  }): IngredientReaction {
    return {
      meddraId: row.reaction.meddraId,
      name: row.reaction.meddraName,
      termType: row.reaction.meddraTermType,
      labelCount: row.labelCount,
      labelSections: orderSections(row.labelSections),
      sources: toStringArray(row.sources).sort((a, b) => a.localeCompare(b)),
      confidenceMax: row.confidenceMax,
    };
  }
}
