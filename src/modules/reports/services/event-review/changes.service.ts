import { Injectable } from '@nestjs/common';
import {
  DailyRecordKind,
  HealthEventOutcome,
} from '#generated/prisma/client.js';
import {
  formatDateOnly,
  summarizeWaterMetrics,
} from '../../../../common/index.js';
import type { WaterMetricInput } from '../../../../common/index.js';
import type { EventReviewSectionDto } from '../../dto/event-review-response.dto.js';

/** Check-in rows ordered by date ascending within the event window. */
export interface ReviewChangeCheckIn {
  date: Date;
  outcome: HealthEventOutcome;
}

/** Daily-record facts inside the event window (reader-port shape). */
export interface ReviewChangeDailyRecord {
  occurredAt: Date;
  kind: DailyRecordKind;
  value: string | null;
  unit: string | null;
  payload: unknown;
}

/** Facts the keyChanges section consumes. */
export interface ReviewChangeFacts {
  checkIns: ReviewChangeCheckIn[];
  dailyRecords: ReviewChangeDailyRecord[];
}

/** Factual outcome trend between the first and last check-in. */
export interface ReviewOutcomeTrend {
  direction: 'improved' | 'unchanged' | 'worsened';
  fromOutcome: HealthEventOutcome;
  toOutcome: HealthEventOutcome;
  firstDate: string;
  lastDate: string;
  count: number;
}

/**
 * Factual single-dimension numeric trend. Water values are in ml and sleep
 * values in hours; Luminous localizes the unit per dimension.
 */
export interface ReviewNumericTrend {
  direction: 'up' | 'flat' | 'down';
  firstValue: number;
  lastValue: number;
  firstDate: string;
  lastDate: string;
  observedDays: number;
}

const OUTCOME_RANK: Record<HealthEventOutcome, number> = {
  worsened: 0,
  unchanged: 1,
  improved: 2,
};

/**
 * KeyChanges section builder.
 *
 * Reports observed change trends only: check-in outcome sequences and
 * single-dimension water/sleep series. It never claims causation (no text
 * such as "the medicine improved the symptom") — only factual change codes
 * with parameters. Dimensions without enough data stay null inside an
 * available section; when no trend is computable at all the section is
 * unknown with a fixed reason code.
 */
@Injectable()
export class EventReviewChangesService {
  build(input: ReviewChangeFacts): EventReviewSectionDto {
    const waterPoints = this.waterPoints(input.dailyRecords);
    const sleepPoints = this.sleepPoints(input.dailyRecords);
    const checkIns = this.outcomeTrend(input.checkIns);
    const water = this.numericTrend(waterPoints);
    const sleep = this.numericTrend(sleepPoints);

    if (checkIns == null && water == null && sleep == null) {
      // Edge note (kept by design): dose logs are completed actions, not
      // change observations — a window with dose logs but no check-ins or
      // water/sleep records still reports `no_observations` here because no
      // change trend can be computed; the dose activity is surfaced by the
      // completedActions section instead.
      const hasAnyObservation =
        input.checkIns.length > 0 ||
        waterPoints.length > 0 ||
        sleepPoints.length > 0;
      return {
        state: 'unknown',
        reasonCode: hasAnyObservation
          ? 'insufficient_coverage'
          : 'no_observations',
      };
    }

    return {
      state: 'available',
      facts: {
        code: 'observed_changes',
        arguments: { checkIns, water, sleep },
      },
    };
  }

  /** Compares the first and last check-in outcomes without causal claims. */
  private outcomeTrend(
    checkIns: ReviewChangeCheckIn[],
  ): ReviewOutcomeTrend | null {
    if (checkIns.length < 2) {
      return null;
    }
    const first = checkIns[0];
    const last = checkIns[checkIns.length - 1];
    if (first == null || last == null) {
      return null;
    }
    const direction =
      OUTCOME_RANK[last.outcome] > OUTCOME_RANK[first.outcome]
        ? 'improved'
        : OUTCOME_RANK[last.outcome] < OUTCOME_RANK[first.outcome]
          ? 'worsened'
          : 'unchanged';
    return {
      direction,
      fromOutcome: first.outcome,
      toOutcome: last.outcome,
      firstDate: formatDateOnly(first.date),
      lastDate: formatDateOnly(last.date),
      count: checkIns.length,
    };
  }

  private numericTrend(
    points: Array<{ date: string; value: number }>,
  ): ReviewNumericTrend | null {
    if (points.length < 2) {
      return null;
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (first == null || last == null) {
      return null;
    }
    return {
      direction:
        last.value > first.value
          ? 'up'
          : last.value < first.value
            ? 'down'
            : 'flat',
      firstValue: first.value,
      lastValue: last.value,
      firstDate: first.date,
      lastDate: last.date,
      observedDays: points.length,
    };
  }

  /** Sums water values per day with the canonical water-metric parser. */
  private waterPoints(
    records: ReviewChangeDailyRecord[],
  ): Array<{ date: string; value: number }> {
    const byDay = new Map<string, WaterMetricInput[]>();
    for (const record of records) {
      if (record.kind !== DailyRecordKind.water) {
        continue;
      }
      const day = formatDateOnly(record.occurredAt);
      const inputs = byDay.get(day);
      if (inputs == null) {
        byDay.set(day, [{ value: record.value, unit: record.unit }]);
      } else {
        inputs.push({ value: record.value, unit: record.unit });
      }
    }

    const points: Array<{ date: string; value: number }> = [];
    for (const day of [...byDay.keys()].sort()) {
      const summary = summarizeWaterMetrics(byDay.get(day) ?? []);
      if (summary.totalMl != null) {
        points.push({ date: day, value: summary.totalMl });
      }
    }
    return points;
  }

  /**
   * Extracts sleep hours per day from payload duration minutes, using the
   * dashboard convention (wake date, last record of the day wins).
   */
  private sleepPoints(
    records: ReviewChangeDailyRecord[],
  ): Array<{ date: string; value: number }> {
    const hoursByDay = new Map<string, number>();
    for (const record of records) {
      if (record.kind !== DailyRecordKind.sleep) {
        continue;
      }
      const payload = record.payload as Record<string, unknown> | null;
      const durationMinutes = payload?.['durationMinutes'];
      if (
        typeof durationMinutes !== 'number' ||
        !Number.isFinite(durationMinutes) ||
        durationMinutes <= 0
      ) {
        continue;
      }
      const hours = Number((durationMinutes / 60).toFixed(1));
      hoursByDay.set(formatDateOnly(record.occurredAt), hours);
    }

    return [...hoursByDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, value]) => ({ date, value }));
  }
}
