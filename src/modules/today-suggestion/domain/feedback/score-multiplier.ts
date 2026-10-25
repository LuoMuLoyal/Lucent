/**
 * Feedback-driven score adjustment (ADR-0024 `domain/feedback/`).
 *
 * ## Why this is a domain rule, not statistics
 *
 * The multiplier decides **which suggestion cards outrank which**. A rule whose
 * cards the user keeps dismissing gets pushed down; one they keep accepting
 * gets pulled up. That is product behaviour, and these thresholds are the
 * behaviour:
 *
 * - below {@link STATS_MIN_SAMPLE_SIZE} feedback rows we do **not** adjust at
 *   all — two dismissals is an anecdote, not a signal, and acting on it would
 *   let a user's first bad day reshape their suggestions;
 * - the boost and the penalty are capped symmetrically (×1.5 / ×0.5) so a rule
 *   can never be buried or promoted without bound.
 *
 * It used to be inline arithmetic inside a Prisma-querying service, where the
 * only way to test it was to mock two tables.
 */

/** Minimum feedback count before any adjustment applies. */
export const STATS_MIN_SAMPLE_SIZE = 5;

/** Maximum boost for a frequently accepted rule. */
export const MAX_BOOST_MULTIPLIER = 1.5;

/** Maximum penalty for a frequently suppressed rule. */
export const MIN_REDUCTION_MULTIPLIER = 0.5;

/** Neutral multiplier: no adjustment. */
export const NEUTRAL_MULTIPLIER = 1;

/**
 * How far an accept ratio may push the multiplier up (added to neutral), and
 * how far a suppress ratio may pull it down.
 *
 * Both are 0.5, which is what makes the caps reachable: a 100% accept ratio
 * yields exactly `1 + 0.5 = 1.5`, a 100% suppress ratio exactly
 * `1 - 0.5 = 0.5`.
 */
const MULTIPLIER_SWING = 0.5;

/** Multipliers are rounded to this many decimals before being returned. */
const MULTIPLIER_DECIMALS = 2;

/** Base of the decimal scale used for that rounding (two decimals → ×100). */
const MULTIPLIER_DECIMAL_BASE = 10;

/** The four feedback kinds, as stored. */
export interface FeedbackCounts {
  accepted: number;
  later: number;
  notApplicable: number;
  suppress: number;
}

/** Ratios derived from the counts. */
export interface FeedbackRatios {
  total: number;
  acceptRatio: number;
  suppressRatio: number;
}

/**
 * Derives the ratios the multiplier is computed from.
 *
 * `total === 0` gives zero ratios rather than `NaN` — an empty sample has no
 * opinion, and `NaN` would poison every comparison downstream.
 */
export function feedbackRatios(counts: FeedbackCounts): FeedbackRatios {
  const total =
    counts.accepted + counts.later + counts.notApplicable + counts.suppress;
  if (total === 0) {
    return { total: 0, acceptRatio: 0, suppressRatio: 0 };
  }
  return {
    total,
    acceptRatio: counts.accepted / total,
    suppressRatio: counts.suppress / total,
  };
}

/**
 * Multiplier applied to a rule's priority score.
 *
 * Returns {@link NEUTRAL_MULTIPLIER} when the sample is too small to speak.
 * Otherwise: `1 + acceptRatio·0.5 − suppressRatio·0.5`, clamped to
 * `[0.5, 1.5]` and rounded to two decimals.
 *
 * Note `later` and `notApplicable` count toward the sample size but carry no
 * direction of their own — a card the user deferred still tells us the rule
 * fires, it just says nothing about whether it was welcome.
 */
export function scoreMultiplier(input: FeedbackRatios): number {
  if (input.total < STATS_MIN_SAMPLE_SIZE) {
    return NEUTRAL_MULTIPLIER;
  }

  const raw =
    NEUTRAL_MULTIPLIER +
    input.acceptRatio * MULTIPLIER_SWING -
    input.suppressRatio * MULTIPLIER_SWING;

  const clamped = Math.max(
    MIN_REDUCTION_MULTIPLIER,
    Math.min(MAX_BOOST_MULTIPLIER, raw),
  );

  const scale = MULTIPLIER_DECIMAL_BASE ** MULTIPLIER_DECIMALS;
  return Math.round(clamped * scale) / scale;
}
