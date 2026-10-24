/**
 * Diet facet vocabulary of the Daily Guidance context (ADR-0024).
 *
 * ## Why this is not `daily-records`' `MealAnalysisItemKind`
 *
 * Upstream publishes **11** facet kinds:
 *
 * ```
 * carb, fat, protein, vegetable, fruit, fried, sugar, sodium, portion,
 * balance, other
 * ```
 *
 * This context consumes **9** of them. `balance` and `other` are deliberately
 * absent: they are not actionable diet dimensions — there is no behaviour to
 * suggest for "balance is high" — so no rule branches on them.
 *
 * The projection is declared here, by the consumer, rather than importing the
 * upstream union. A signal is a **fact contract between contexts, and a
 * contract must be written in the receiver's language**: if this type carried
 * `balance` / `other`, a future rule author would see them in the type and
 * write handling for values that no data path ever produces. "Present in the
 * type but never consumed" is the worst of both worlds — it looks available
 * while being dead.
 *
 * The payoff is that upstream adding a 12th kind requires **no change here**:
 * the collector's projection drops what this context does not know (see
 * `RecordCollectorService.buildDailyFacets`, which reports the drop).
 */

/** A diet facet this context can actually reason about. */
export const DIET_FACET_KINDS = [
  'fried',
  'sugar',
  'sodium',
  'fat',
  'portion',
  'carb',
  'vegetable',
  'fruit',
  'protein',
] as const;

export type DietFacetKind = (typeof DIET_FACET_KINDS)[number];

/** Facet level as this context reads it: below / at / above the reference. */
export type DietFacetLevel = 'low' | 'ok' | 'high';

/**
 * Narrows an upstream facet key to a kind this context understands.
 *
 * Returns `null` for anything else — including kinds upstream may add later.
 * The caller decides whether to report the drop; this function only answers the
 * question, so it stays a pure predicate.
 */
export function asDietFacetKind(value: string): DietFacetKind | null {
  return (DIET_FACET_KINDS as readonly string[]).includes(value)
    ? (value as DietFacetKind)
    : null;
}
