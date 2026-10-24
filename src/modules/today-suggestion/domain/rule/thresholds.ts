/**
 * Numeric parameters of the suggestion rules (ADR-0024 `domain/rule/`).
 *
 * These are the numbers the rules compare against and score with. They live in
 * `domain/` because they *are* the product behaviour: `WATER_SHORTFALL_MIN_DAYS`
 * is not a tuning knob on the side, it is the statement "one off day is not a
 * habit". Keeping them next to the rule contract means a rule and its
 * thresholds move together.
 *
 * ## What is deliberately NOT here
 *
 * `constants/thresholds.constants.ts` used to hold these together with two
 * unrelated families, which is why the file could not simply move:
 *
 * - **cache TTLs** (`SIGNAL_CACHE_TTL_MS`, …) — infrastructure policy, read by
 *   `services/cache/`;
 * - **arbitration** (`MAX_SECONDARY_CARDS`) — a presentation/arbitration limit,
 *   read by `services/arbitration/`.
 *
 * Those stay in `constants/`. This file holds only what the rules need.
 */

// ── Missed dose ────────────────────────────────────────────────────────────

/** Minimum overdue minutes before a missed-dose candidate is generated. */
export const MISSED_DOSE_GRACE_MINUTES = 30;

/** Base priority score for a missed-dose candidate. */
export const MISSED_DOSE_BASE_SCORE = 800;

/** Score increment per overdue 10 minutes. */
export const MISSED_DOSE_OVERDUE_DIVISOR = 10;

/**
 * Upper bounds of a wall-clock time, used to reject malformed `scheduledHour` /
 * `scheduledMinute` payload values before a rule formats them into a label.
 *
 * A 25:00 label rendered from a bad payload would look like a real schedule
 * time, so the rule drops the signal instead.
 */
export const MAX_HOUR_OF_DAY = 23;
export const MAX_MINUTE_OF_HOUR = 59;

// ── Shared unit scales ─────────────────────────────────────────────────────

/** Minutes in an hour — the divisor for every "Xh Ym" label in this module. */
export const MINUTES_PER_HOUR = 60;

/** Percent scale for rendering a 0–1 ratio in copy params. */
export const PERCENT_SCALE = 100;

/**
 * Length of a `YYYY-MM-DD` date prefix, for slicing an ISO timestamp down to
 * its date part.
 */
export const DATE_ONLY_LENGTH = 10;

// ── Water ──────────────────────────────────────────────────────────────────

/** Fraction of daily water target below which a behavior-advice card fires. */
export const WATER_SHORTFALL_THRESHOLD = 0.5;

/** Base priority score for a water-shortfall candidate. */
export const WATER_SHORTFALL_BASE_SCORE = 400;

/** Minimum consecutive recording days before water-shortfall fires. */
export const WATER_SHORTFALL_MIN_DAYS = 2;

// ── Trend ──────────────────────────────────────────────────────────────────

/** Look-back window (days) for trend analysis. */
export const TREND_LOOKBACK_DAYS = 7;

/** Minimum consecutive days for a deteriorating trend. */
export const TREND_MIN_CONSECUTIVE_DAYS = 2;

/** Minimum symptom records in the look-back window. */
export const TREND_MIN_RECORDS = 3;

/** Base priority score for a deteriorating-trend candidate. */
export const DETERIORATING_TREND_BASE_SCORE = 700;

/**
 * Days of sustained worsening at which the trend card is shown with high
 * confidence rather than medium.
 */
export const DETERIORATING_TREND_HIGH_CONFIDENCE_DAYS = 4;

// ── Sleep ──────────────────────────────────────────────────────────────────

/** Base priority score for a sleep-shortfall candidate. */
export const SLEEP_SHORTFALL_BASE_SCORE = 450;

/**
 * Sleep duration below which sleep counts as short (minutes).
 *
 * Shared deliberately by `sleep_shortfall` (which advises on it) and
 * `mood_sleep` (which correlates it with mood): both ask about the same
 * product notion of "short sleep", so one number keeps them from drifting
 * apart and disagreeing about what short means.
 */
export const SLEEP_SHORTFALL_MINUTES = 360; // 6 hours

/** Minimum consecutive sleep records before sleep-shortfall fires. */
export const SLEEP_SHORTFALL_MIN_DAYS = 2;

// ── Coverage ───────────────────────────────────────────────────────────────

/** Base priority score for a coverage-explanation candidate. */
export const COVERAGE_BASE_SCORE = 200;

/**
 * How far below {@link COVERAGE_BASE_SCORE} the "nothing recorded today" card
 * scores: it is the weakest coverage signal, so it must not outrank the
 * missing-profile and empty-medication-box variants.
 */
export const COVERAGE_EMPTY_TODAY_SCORE_OFFSET = 50;

// ── Diet ───────────────────────────────────────────────────────────────────

/** Base priority score for a diet-imbalance candidate. */
export const DIET_IMBALANCE_BASE_SCORE = 500;

/**
 * 同一个饮食维度至少要出现在多少天，才构成「结构性问题」而不是偶发一餐。
 * 与水分/睡眠的 MIN_DAYS 同为 2：单日一次不做行为建议。
 */
export const DIET_IMBALANCE_MIN_DAYS = 2;

// ── Mood × sleep ───────────────────────────────────────────────────────────

/** Base priority score for a mood-sleep correlation candidate. */
export const MOOD_SLEEP_BASE_SCORE = 550;

/** Minimum consecutive days for mood-sleep correlation. */
export const MOOD_SLEEP_MIN_DAYS = 2;

/** Mood score threshold below which mood is considered "low" (1–5 scale). */
export const MOOD_LOW_THRESHOLD = 2;
