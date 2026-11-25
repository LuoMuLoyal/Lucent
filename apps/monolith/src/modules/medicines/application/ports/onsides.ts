/**
 * OnSIDES adverse-reaction contracts (`application/ports`).
 *
 * OnSIDES is its **own knowledge source**, not fields on the DrugBank detail:
 *
 * - it is keyed by RxNorm ingredient CUI + MedDRA term, not by our medicine id;
 * - it holds no drug record (no name, indication, mechanism or interaction graph);
 * - its facts are **label-stated**, i.e. "the label says this ingredient causes
 *   this reaction", never an observed incidence.
 *
 * Keeping it separate is what lets the reverse question ("which drugs could cause
 * this reaction") be answered at all: routing it through the DrugBank detail would
 * have made the response shape depend on whether an RxCUI mapping exists.
 */

/** One reaction as stated by at least one label for a given ingredient. */
export interface IngredientReaction {
  meddraId: string;
  name: string;
  /** MedDRA term type; LLT today. */
  termType: string;
  /** Number of distinct labels that stated this pair. Not a frequency. */
  labelCount: number;
  /** Distinct label sections (AR / WP / NA / BW), AR first. */
  labelSections: string[];
  /** Distinct regulatory sources (US / JP / UK / EU). */
  sources: string[];
  /**
   * max(pred1) over the aggregated hits, NOT pred0.
   *
   * pred0 is 0 for 44.5% of source rows (meaning "no score given") and above 1 for
   * 36% of them, so it cannot carry a threshold. Nullable on purpose: `null` means
   * "unscored", which is a different thing from a low score.
   */
  confidenceMax: number | null;
}

/** One ingredient's adverse reactions, keyed by RxNorm CUI. */
export interface IngredientReactionsView {
  source: 'onsides';
  /** RxNorm ingredient CUI — the key the source actually uses. */
  rxnormCui: string;
  /** Upstream OnSIDES version the rows came from. */
  sourceVersion: string;
  reactions: IngredientReaction[];
}

/** One drug that could cause a reaction — the reverse direction. */
export interface ReactionDrugView {
  drugbankId: string;
  name: string;
  /** Number of distinct labels linking this drug to the reaction. */
  labelCount: number;
  confidenceMax: number | null;
}

/** One reaction's drug list, keyed by MedDRA term. */
export interface ReactionDrugsView {
  source: 'onsides';
  meddraId: string;
  meddraName: string | null;
  drugs: ReactionDrugView[];
}

/** Reader contract for the OnSIDES source. */
export const ONSIDES_REACTIONS_READER = 'ONSIDES_REACTIONS_READER';

/**
 * Bounds on the reverse-lookup list.
 *
 * A single MedDRA term can be stated by thousands of labels, so the endpoint needs
 * a cap; the floor exists because `limit=0` is a request that can only be a bug on
 * the caller's side, and answering it with an empty list hides that.
 */
export const MIN_REACTION_DRUG_LIMIT = 1;
export const MAX_REACTION_DRUG_LIMIT = 200;
export const DEFAULT_REACTION_DRUG_LIMIT = 50;

export interface OnsidesReactionsReader {
  /** Reactions stated for one ingredient CUI; null when no such ingredient. */
  getByIngredient(rxnormCui: string): Promise<IngredientReactionsView | null>;

  /**
   * Resolves a DrugBank id to its ingredient CUI through the existing
   * `drugbank_external_identifiers` bridge (resource = 'RxCUI') and returns that
   * ingredient's reactions. Null when the drug has no RxCUI mapping — which is
   * 91.8% of DrugBank rows, so callers must treat null as "no bridge", not "error".
   */
  getByDrugbankId(drugbankId: string): Promise<IngredientReactionsView | null>;

  /** Which drugs could cause one MedDRA term. */
  getReactionDrugs(
    meddraId: string,
    limit: number,
  ): Promise<ReactionDrugsView | null>;
}
