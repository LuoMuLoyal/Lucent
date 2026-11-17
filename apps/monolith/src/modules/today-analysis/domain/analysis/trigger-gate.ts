/**
 * Dimension aggregation and the trigger gate for Today Analysis.
 *
 * **Judgement B (see the module README):** the dimension whitelist, the recent
 * window, the record-count floor and the baseline-shift threshold *are* the
 * product behaviour — "one glass of water must not recompute the analysis" is
 * this threshold, not a tuning knob. ADR-0024 puts product behaviour in
 * `domain/`, and `today-suggestion`'s `domain/rule/thresholds.ts` made the same
 * call. The whitelist used to live in `adapters/queue/event-consumer.ts` while
 * the thresholds lived in a service: two halves of one decision in two layers.
 * They are together here.
 *
 * **No I/O, no framework.** Reading the records needs `DailyRecordReaderPort`,
 * which `ddd-domain-purity` forbids here; `application/services/trigger-gate.ts`
 * fetches and this file decides.
 */

/** The dimensions whose change can re-trigger the analysis. */
export type TriggerDimension = 'water' | 'meal' | 'sleep' | 'mood';

/** The dimension whitelist, as data so callers can test membership. */
export const TRIGGER_DIMENSIONS: readonly TriggerDimension[] = [
  'water',
  'meal',
  'sleep',
  'mood',
];

/** How many days back "recent" reaches. */
export const RECENT_WINDOW_DAYS = 7;

/**
 * How many days back the reader must fetch.
 *
 * Wider than the recent window so the prior baseline has history to be stable
 * against; a baseline computed from three days is noise.
 */
export const FETCH_WINDOW_DAYS = 14;

/** Record count in the recent window above which a dimension always triggers. */
export const MIN_RECENT_RECORDS_FOR_TRIGGER = 3;

/** Relative deviation from the prior baseline that counts as a shift. */
export const BASELINE_SHIFT_THRESHOLD = 0.5;

/** The mood scale floor. */
const MOOD_SCORE_MIN = 1;

/** The mood scale ceiling. */
const MOOD_SCORE_MAX = 5;

/** The "good" tier on the 1-5 mood scale. */
const MOOD_SCORE_GOOD = 4;

/** The "neutral" tier on the 1-5 mood scale. */
const MOOD_SCORE_NEUTRAL = 3;

/** One record as the gate sees it. */
export interface TriggerRecord {
  /** `YYYY-MM-DD` in the user's calendar, resolved by the caller. */
  readonly localDate: string;
  /** The dimension's own value (see the per-dimension rules below). */
  readonly value: number;
}

/**
 * Aggregates one day's records for `kind` into a single comparable value.
 *
 * The per-dimension rules are intentionally *not* unified: the caller extracts
 * `value` per dimension (water sums mL, sleep reads the first record's
 * `durationMinutes`, mood averages 1-5 scores, meal counts analyzed meals), so
 * this function only sums what it is given. Collapsing those rules into one
 * shape would silently change what counts as a shift.
 */
export function aggregateDimension(
  _kind: TriggerDimension,
  records: readonly TriggerRecord[],
): number {
  return records.reduce(
    (sum, record) => sum + (record.value > 0 ? record.value : 0),
    0,
  );
}

/** Averages the per-day totals; `0` when there is nothing to average. */
export function computeBaselineAverage(
  kind: TriggerDimension,
  records: readonly TriggerRecord[],
): number {
  if (records.length === 0) {
    return 0;
  }
  const byDate = new Map<string, TriggerRecord[]>();
  for (const record of records) {
    const group = byDate.get(record.localDate) ?? [];
    group.push(record);
    byDate.set(record.localDate, group);
  }
  const dailyValues = Array.from(byDate.values()).map((dayRecords) =>
    aggregateDimension(kind, dayRecords),
  );
  if (dailyValues.length === 0) {
    return 0;
  }
  return (
    dailyValues.reduce((sum, value) => sum + value, 0) / dailyValues.length
  );
}

/**
 * Decides whether a dimension's change should re-run the analysis.
 *
 * Two independent triggers: enough signal in the recent window, or a sharp
 * shift against the prior baseline.
 */
export function shouldTriggerDimension(
  kind: TriggerDimension,
  today: string,
  records: readonly TriggerRecord[],
  recentStart: string,
): boolean {
  const recent = records.filter((record) => record.localDate >= recentStart);
  if (recent.length >= MIN_RECENT_RECORDS_FOR_TRIGGER) {
    return true;
  }

  const todayRecords = records.filter((record) => record.localDate === today);
  const todayValue = aggregateDimension(kind, todayRecords);

  const priorRecords = records.filter(
    (record) => record.localDate < recentStart,
  );
  const priorBaseline = computeBaselineAverage(kind, priorRecords);

  // A zero baseline means there is nothing to shift away from: "0 -> 5" is a
  // first observation, not a trend. Treating it as a trigger would fire on
  // every user's first record of the day.
  if (priorBaseline <= 0) {
    return false;
  }

  return (
    Math.abs(todayValue - priorBaseline) / priorBaseline >=
    BASELINE_SHIFT_THRESHOLD
  );
}

/**
 * Mood score from a record's value or its free-text title.
 *
 * Exported because mood is the one dimension whose value is derived from text,
 * and the caller needs it while mapping records.
 */
export function parseMoodScore(
  value: string | null,
  title: string | null,
): number | null {
  if (value != null) {
    const num = Number(value);
    if (
      Number.isFinite(num) &&
      num >= MOOD_SCORE_MIN &&
      num <= MOOD_SCORE_MAX
    ) {
      return num;
    }
  }
  const text = (title ?? '').toLowerCase();
  if (
    text.includes('great') ||
    text.includes('很好') ||
    text.includes('开心')
  ) {
    return MOOD_SCORE_MAX;
  }
  if (text.includes('good') || text.includes('好') || text.includes('happy')) {
    return MOOD_SCORE_GOOD;
  }
  if (
    text.includes('ok') ||
    text.includes('fine') ||
    text.includes('还好') ||
    text.includes('一般')
  ) {
    return MOOD_SCORE_NEUTRAL;
  }
  if (text.includes('bad') || text.includes('不好') || text.includes('难过')) {
    return 2;
  }
  if (
    text.includes('awful') ||
    text.includes('很糟') ||
    text.includes('很差')
  ) {
    return MOOD_SCORE_MIN;
  }
  return null;
}

/** True when `value` is a dimension the gate understands. */
export function isTriggerDimension(value: string): value is TriggerDimension {
  return (TRIGGER_DIMENSIONS as readonly string[]).includes(value);
}
