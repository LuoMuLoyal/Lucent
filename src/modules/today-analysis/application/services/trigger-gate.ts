import { Injectable } from '@nestjs/common';
import { DailyRecordKind } from '#generated/prisma/client.js';
import {
  DailyRecordReaderPort,
  parseMealRecordPayload,
  type DailyRecordFact,
} from '../../../daily-records/index.js';
import {
  FETCH_WINDOW_DAYS,
  RECENT_WINDOW_DAYS,
  aggregateDimension,
  isTriggerDimension,
  parseMoodScore,
  shouldTriggerDimension,
  type TriggerDimension,
  type TriggerRecord,
} from '../../domain/analysis/trigger-gate.js';

/**
 * The I/O half of the trigger gate (judgement B in the module README).
 *
 * Fetches the records and maps each `DailyRecordFact` into the
 * dimension-specific value the domain rules expect, then delegates the decision
 * to `domain/analysis/trigger-gate.ts`. The split exists because the domain
 * cannot depend on `DailyRecordReaderPort`.
 *
 * **The per-dimension extraction stays here** and is deliberately not
 * generalised: water sums mL, sleep reads the first record's `durationMinutes`,
 * mood averages 1–5 scores, meal counts analyzed meals. Those are data-shape
 * details of the source record, not product decisions.
 */
@Injectable()
export class TriggerGateService {
  constructor(private readonly dailyRecordReader: DailyRecordReaderPort) {}

  async shouldTriggerForDimension(
    userId: string,
    date: string,
    kind: TriggerDimension,
  ): Promise<boolean> {
    const day = new Date(`${date}T00:00:00.000Z`);
    const fetchStart = new Date(day);
    fetchStart.setUTCDate(fetchStart.getUTCDate() - (FETCH_WINDOW_DAYS - 1));

    const facts = await this.dailyRecordReader.listFactsInRange(
      userId,
      fetchStart,
      day,
      [toDailyRecordKind(kind)],
    );

    const recentStart = new Date(day);
    recentStart.setUTCDate(recentStart.getUTCDate() - (RECENT_WINDOW_DAYS - 1));

    return shouldTriggerDimension(
      kind,
      date,
      groupFactsByDate(facts, kind),
      recentStart.toISOString().slice(0, ISO_DATE_LENGTH),
    );
  }
}

/** The gate dimension maps onto the Prisma enum used for the query. */
function toDailyRecordKind(kind: TriggerDimension): DailyRecordKind {
  switch (kind) {
    case 'water':
      return DailyRecordKind.water;
    case 'meal':
      return DailyRecordKind.meal;
    case 'sleep':
      return DailyRecordKind.sleep;
    case 'mood':
      return DailyRecordKind.mood;
  }
}

/**
 * Maps facts into `{ localDate, value }` under the dimension's own rule.
 *
 * `value` is per-record; the domain's `aggregateDimension` sums the day's
 * entries. For sleep that means one record carries the night's duration; for
 * meal each analyzed meal contributes `1`.
 */
function groupFactsByDate(
  facts: readonly DailyRecordFact[],
  kind: TriggerDimension,
): TriggerRecord[] {
  const records: TriggerRecord[] = [];
  // Every record becomes a TriggerRecord, including ones whose dimension value
  // is zero or absent. The recent-window trigger counts records, not aggregated
  // signal: an unanalyzed meal still proves the user was logging that day.
  // Filtering here would shrink that count and change when the gate fires, so
  // dimensionValue contributes 0 rather than skipping the row.
  for (const fact of facts) {
    records.push({
      localDate: dayOf(fact.occurredAt),
      value: dimensionValue(fact, kind) ?? 0,
    });
  }
  return records;
}

/**
 * One fact's contribution to its dimension, or `null` when it carries none.
 *
 * `null` (not `0`) matters: `0` would occupy a day bucket and drag the baseline
 * down, which is exactly the "one glass of water" the threshold is meant to
 * ignore.
 */
function dimensionValue(
  fact: DailyRecordFact,
  kind: TriggerDimension,
): number | null {
  switch (kind) {
    case 'water': {
      const value = Number(fact.value);
      return Number.isFinite(value) && value > 0 ? value : null;
    }
    case 'sleep': {
      const payload = fact.payload as Record<string, unknown> | null;
      const minutes = payload?.['durationMinutes'];
      return typeof minutes === 'number' && minutes > 0 ? minutes : null;
    }
    case 'mood':
      return parseMoodScore(fact.value, fact.title);
    case 'meal': {
      const payload = parseMealRecordPayload(fact.payload);
      return payload.mealAnalysis?.analysisStatus === 'analyzed' ? 1 : null;
    }
  }
}

/** `YYYY-MM-DD` occupies the first ten characters of an ISO timestamp. */

/**
 * The calendar day of `occurredAt`.
 *
 * Returns an empty string for an unparseable timestamp instead of throwing:
 * the reader normalises `occurredAt` to a real Date, so this only matters for
 * doubles that build dates from strings, and one malformed fixture row must not
 * take down the whole gate.
 */
function dayOf(occurredAt: Date): string {
  const time = occurredAt.getTime();
  if (Number.isNaN(time)) {
    return '';
  }
  return occurredAt.toISOString().slice(0, ISO_DATE_LENGTH);
}
const ISO_DATE_LENGTH = 10;

/** Re-exported so callers do not import the domain module directly. */
export { aggregateDimension, isTriggerDimension };
