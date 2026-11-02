/**
 * Materialization limits and reason codes for Today Analysis.
 *
 * These are product rules, not infrastructure tuning: "at most three
 * generations per day" and "wait five minutes before recomputing" are what the
 * user experiences, so per ADR-0024 they belong with the other domain
 * thresholds. They are also needed by the application-layer port, which
 * `ddd-application-no-infra-or-adapters` forbids from importing
 * `infrastructure/`.
 */

/** How long a manual refresh waits before another may start. */
const REFRESH_COOLDOWN_MINUTES = 5;

/** How long a claim holds before another worker may take it. */
const CLAIM_TIMEOUT_MINUTES = 15;

/** Seconds in a minute. */
const SECONDS_PER_MINUTE = 60;

/** Milliseconds in a second. */
const MILLISECONDS_PER_SECOND = 1000;

/** Milliseconds in one minute. */
const MILLISECONDS_PER_MINUTE = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

export const TODAY_ANALYSIS_MAX_GENERATIONS_PER_DATE = 3;
export const TODAY_ANALYSIS_REFRESH_COOLDOWN_MS =
  REFRESH_COOLDOWN_MINUTES * MILLISECONDS_PER_MINUTE;
export const TODAY_ANALYSIS_CLAIM_TIMEOUT_MS =
  CLAIM_TIMEOUT_MINUTES * MILLISECONDS_PER_MINUTE;

export const TODAY_ANALYSIS_REASON_CODES = [
  'symptom_check_in',
  'daily_record_changed',
  'health_event_changed',
  'dose_log_changed',
  'suggestion_materialization_changed',
  'manual_refresh',
] as const;

export type TodayAnalysisReasonCode =
  (typeof TODAY_ANALYSIS_REASON_CODES)[number];

export type PersistedTodayAnalysisStatus =
  | 'pending'
  | 'ready'
  | 'failed'
  | 'capped';

export type TodayAnalysisStatus =
  | 'pending'
  | 'ready'
  | 'failed'
  | 'stale'
  | 'empty';
