/** Minimum overdue minutes before a missed-dose candidate is generated. */
export const MISSED_DOSE_GRACE_MINUTES = 30;

/** Base priority score for a missed-dose candidate. */
export const MISSED_DOSE_BASE_SCORE = 800;

/** Score increment per overdue 10 minutes. */
export const MISSED_DOSE_OVERDUE_DIVISOR = 10;

/** Fraction of daily water target below which a behavior-advice card fires. */
export const WATER_SHORTFALL_THRESHOLD = 0.5;

/** Base priority score for a water-shortfall candidate. */
export const WATER_SHORTFALL_BASE_SCORE = 400;

/** Minimum consecutive recording days before water-shortfall fires. */
export const WATER_SHORTFALL_MIN_DAYS = 2;

/** Look-back window (days) for trend analysis. */
export const TREND_LOOKBACK_DAYS = 7;

/** Minimum consecutive days for a deteriorating trend. */
export const TREND_MIN_CONSECUTIVE_DAYS = 2;

/** Minimum symptom records in the look-back window. */
export const TREND_MIN_RECORDS = 3;

/** Base priority score for a deteriorating-trend candidate. */
export const DETERIORATING_TREND_BASE_SCORE = 700;

/** Base priority score for a sleep-shortfall candidate. */
export const SLEEP_SHORTFALL_BASE_SCORE = 450;

/** Sleep duration below which a shortfall card fires (minutes). */
export const SLEEP_SHORTFALL_MINUTES = 360; // 6 hours

/** Minimum consecutive sleep records before sleep-shortfall fires. */
export const SLEEP_SHORTFALL_MIN_DAYS = 2;

/** Base priority score for a coverage-explanation candidate. */
export const COVERAGE_BASE_SCORE = 200;

/** Base priority score for a caffeine-sleep correlation candidate. */
export const CAFFEINE_SLEEP_BASE_SCORE = 600;

/** Minimum consecutive days of caffeine records for correlation. */
export const CAFFEINE_SLEEP_MIN_DAYS = 2;

/** Minimum sleep duration decline (minutes) to consider for correlation. */
export const CAFFEINE_SLEEP_DECLINE_MINUTES = 30;

/** Base priority score for a mood-sleep correlation candidate. */
export const MOOD_SLEEP_BASE_SCORE = 550;

/** Minimum consecutive days for mood-sleep correlation. */
export const MOOD_SLEEP_MIN_DAYS = 2;

/** Mood score threshold below which mood is considered "low" (1–5 scale). */
export const MOOD_LOW_THRESHOLD = 2;

/** Confidence threshold: candidates below this are demoted to observations. */
export const CONFIDENCE_DEMOTE_THRESHOLD = 'low';

/** Maximum number of secondary suggestion cards. */
export const MAX_SECONDARY_CARDS = 2;

/** Cache TTL for signal bundles (milliseconds). */
export const SIGNAL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/** Cache TTL for final suggestion results (milliseconds). */
export const SUGGESTION_CACHE_TTL_MS = 3 * 60 * 1000; // 3 min

/** Cache TTL for baseline records (milliseconds). */
export const BASELINE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
