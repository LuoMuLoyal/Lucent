import { Injectable } from '@nestjs/common';
import { DailyRecordKind } from '#generated/prisma/client.js';
import { DailyRecordReaderPort } from '../../../daily-records/index.js';
import type { DailyRecordFact } from '../../../daily-records/index.js';
import { parseMealRecordPayload } from '../../../daily-records/index.js';

type TriggerDimension = 'water' | 'meal' | 'sleep' | 'mood';

/**
 * Signal gate for event-driven Today Analysis recompute.
 *
 * A dimension triggers analysis when either (a) it accumulated at least
 * {@link MIN_RECENT_RECORDS_FOR_TRIGGER} records in the last
 * {@link RECENT_WINDOW_DAYS} days, or (b) today's aggregated value deviates
 * from the prior baseline by at least {@link BASELINE_SHIFT_THRESHOLD}.
 * The reader fetches a wider {@link FETCH_WINDOW_DAYS} window so the baseline
 * (everything before the recent window) has enough history to be stable.
 */
const RECENT_WINDOW_DAYS = 7;
const FETCH_WINDOW_DAYS = 14;
const MIN_RECENT_RECORDS_FOR_TRIGGER = 3;
const BASELINE_SHIFT_THRESHOLD = 0.5;

/**
 * Evaluates whether a daily-record change for a given dimension should trigger
 * Today Analysis recompute.
 *
 * Extracted from `TodayAnalysisContextService` to isolate the dimension-level
 * gate logic (coverage threshold + baseline-shift detection) from the context
 * assembly pipeline.
 */
@Injectable()
export class TriggerEvaluatorService {
  constructor(private readonly dailyRecordReader: DailyRecordReaderPort) {}

  /**
   * Dimension-level gate for event-driven Today Analysis recompute.
   *
   * A daily-record change for water/meal/sleep/mood only triggers analysis when
   * either the dimension has accumulated enough signal in the last
   * {@link RECENT_WINDOW_DAYS} days, or today's value represents a sharp shift
   * versus the prior baseline.
   */
  async shouldTriggerForDimension(
    userId: string,
    date: string,
    kind: TriggerDimension,
  ): Promise<boolean> {
    const day = parseDateOnly(date);
    const start = new Date(day);
    start.setUTCDate(start.getUTCDate() - (FETCH_WINDOW_DAYS - 1));
    const records = await this.dailyRecordReader.listFactsInRange(
      userId,
      start,
      day,
      [kind],
    );

    const last7Days = new Date(day);
    last7Days.setUTCDate(last7Days.getUTCDate() - (RECENT_WINDOW_DAYS - 1));

    const recentRecords = records.filter((r) => r.occurredAt >= last7Days);
    const priorRecords = records.filter((r) => r.occurredAt < last7Days);

    const coverage = recentRecords.length;
    if (coverage >= MIN_RECENT_RECORDS_FOR_TRIGGER) {
      return true;
    }

    const todayRecords = records.filter(
      (r) => r.occurredAt.toISOString().slice(0, 10) === date,
    );

    const todayValue = this.aggregateDimensionValue(kind, todayRecords);
    const priorBaseline = this.computeBaselineAverage(kind, priorRecords);

    if (priorBaseline <= 0) {
      return false;
    }

    const change = Math.abs(todayValue - priorBaseline) / priorBaseline;
    return change >= BASELINE_SHIFT_THRESHOLD;
  }

  aggregateDimensionValue(
    kind: TriggerDimension,
    records: DailyRecordFact[],
  ): number {
    switch (kind) {
      case DailyRecordKind.water: {
        return records.reduce((sum, record) => {
          const value = Number(record.value);
          return sum + (Number.isFinite(value) && value > 0 ? value : 0);
        }, 0);
      }
      case DailyRecordKind.sleep: {
        const record = records[0];
        if (record == null) return 0;
        const payload = record.payload as Record<string, unknown> | null;
        const durationMinutes =
          typeof payload?.['durationMinutes'] === 'number'
            ? payload['durationMinutes']
            : null;
        return typeof durationMinutes === 'number' && durationMinutes > 0
          ? durationMinutes
          : 0;
      }
      case DailyRecordKind.mood: {
        if (records.length === 0) return 0;
        const scores = records
          .map((record) => parseMoodScore(record.value, record.title))
          .filter((score): score is number => score != null);
        if (scores.length === 0) return 0;
        return scores.reduce((sum, score) => sum + score, 0) / scores.length;
      }
      case DailyRecordKind.meal: {
        return records.filter((record) => isAnalyzedMeal(record)).length;
      }
      default:
        return records.length;
    }
  }

  computeBaselineAverage(
    kind: TriggerDimension,
    records: DailyRecordFact[],
  ): number {
    if (records.length === 0) {
      return 0;
    }

    const byDate = new Map<string, DailyRecordFact[]>();
    for (const record of records) {
      const dateKey = record.occurredAt.toISOString().slice(0, 10);
      const group = byDate.get(dateKey) ?? [];
      group.push(record);
      byDate.set(dateKey, group);
    }

    const dailyValues = Array.from(byDate.values()).map((dayRecords) =>
      this.aggregateDimensionValue(kind, dayRecords),
    );

    if (dailyValues.length === 0) {
      return 0;
    }

    return (
      dailyValues.reduce((sum, value) => sum + value, 0) / dailyValues.length
    );
  }
}

// ── Pure helpers (module-private, no DI) ──────────────────────────────────

function isAnalyzedMeal(record: DailyRecordFact): boolean {
  const payload = parseMealRecordPayload(record.payload);
  const status = payload.mealAnalysis?.analysisStatus;
  return status === 'confirmed' || status === 'unconfirmed';
}

function parseMoodScore(
  value: string | null,
  title: string | null,
): number | null {
  if (value != null) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 1 && num <= 5) return num;
  }

  const text = (title ?? '').toLowerCase();
  if (text.includes('great') || text.includes('很好') || text.includes('开心'))
    return 5;
  if (text.includes('good') || text.includes('好') || text.includes('happy'))
    return 4;
  if (
    text.includes('ok') ||
    text.includes('fine') ||
    text.includes('还好') ||
    text.includes('一般')
  )
    return 3;
  if (text.includes('bad') || text.includes('不好') || text.includes('难过'))
    return 2;
  if (
    text.includes('terrible') ||
    text.includes('很差') ||
    text.includes('崩溃')
  )
    return 1;

  return null;
}

function parseDateOnly(date: string): Date {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    // eslint-disable-next-line error-handling/no-bare-throw-error -- DI-time validation, caller never passes invalid user input
    throw new Error(`Invalid date string: ${date}`);
  }
  return d;
}
