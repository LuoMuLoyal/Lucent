/**
 * Module-level tuning that is **not** rule behaviour.
 *
 * The rule thresholds moved to `domain/rule/thresholds.ts` (ADR-0024) — they
 * are product statements and travel with the rules. What remains here is
 * infrastructure and presentation policy, which is why this file stays outside
 * `domain/`:
 *
 * - cache TTLs, read by `services/cache/`;
 * - the arbitration/presentation card limit, read by `services/arbitration/`.
 */

/** Confidence threshold: candidates below this are demoted to observations. */
export const CONFIDENCE_DEMOTE_THRESHOLD = 'low';

/** Cache TTL for signal bundles (milliseconds). */
export const SIGNAL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/** Cache TTL for final suggestion results (milliseconds). */
export const SUGGESTION_CACHE_TTL_MS = 3 * 60 * 1000; // 3 min

/** Cache TTL for baseline records (milliseconds). */
export const BASELINE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
