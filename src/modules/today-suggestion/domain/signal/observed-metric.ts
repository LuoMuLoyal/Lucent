/**
 * The metric view a **signal carries**, as Daily Guidance consumes it.
 *
 * ## Why this is not `common`'s `ObservedMetric`
 *
 * `common/types/observed-metric.types.ts` is the *producer* contract: eight
 * fields covering provenance (`sources`), counts (`observedCount`,
 * `expectedCount`) and the observation window (`windowStart`, `windowEnd`).
 * Rules here read exactly three of them — `value`, `state`, `coverage`.
 *
 * `domain/` may not import `src/common/` (ADR-0024 rule `ddd-domain-purity`),
 * and that constraint turns out to be the right design: this projection is
 * declared by the **consumer**, so the upstream contract can grow a field
 * without reaching the rules, and "the rule does not understand this metric"
 * stays expressible. Re-declaring the full eight fields would just be the
 * upstream type copied across a boundary — every upstream change would then
 * become a downstream change.
 *
 * The literals match `common`'s on purpose, so a producer's value assigns
 * structurally without a cast.
 */

/** Whether the metric has a trustworthy observed value. */
export type SignalMetricState = 'observed' | 'unknown';

/** How much of the metric's expected window the observations cover. */
export type SignalMetricCoverage = 'sufficient' | 'partial' | 'none';

/**
 * A sparse observation carried on a signal payload.
 *
 * `value: null` with `state: 'unknown'` means no trustworthy value is
 * available — deliberately distinct from an observed zero, which is a real
 * measurement.
 */
export interface SignalObservedMetric<T = unknown> {
  value: T | null;
  state: SignalMetricState;
  coverage: SignalMetricCoverage;
}
