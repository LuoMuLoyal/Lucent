import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import { parseDateOnly } from '../../../../common/index.js';
import {
  BaselineDimension,
  BASELINE_MIN_DAYS,
} from '../../types/baseline.types.js';
import type { BaselineRecord } from '../../types/baseline.types.js';
import type { SuggestionSignal } from '../../types/signal.types.js';

/**
 * Tracks cold-start baselines per user per dimension.
 *
 * Each dimension (water, sleep, symptom, etc.) must accumulate
 * a minimum number of consecutive recording days before
 * trend/behavior rules are allowed to fire.
 */
@Injectable()
export class BaselineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns whether the baseline is ready for the given dimension.
   * Checks the DB for stored baseline records.
   */
  async isBaselineReady(
    userId: string,
    dimension: BaselineDimension,
  ): Promise<boolean> {
    const baseline = await this.getBaseline(userId, dimension);
    return baseline?.establishedAt != null;
  }

  /**
   * Returns the stored baseline record, or null if none exists.
   */
  async getBaseline(
    userId: string,
    dimension: BaselineDimension,
  ): Promise<BaselineRecord | null> {
    const record = await this.prisma.userSuggestionBaseline.findUnique({
      where: {
        userId_dimension: { userId, dimension },
      },
    });

    if (record == null) return null;

    return {
      userId,
      dimension,
      daysCollected: record.daysCollected,
      baselineValue: record.baselineValue,
      establishedAt: record.establishedAt,
    };
  }

  /**
   * Returns a map of all dimension readiness for the user.
   * Used by the RuleContext to avoid per-dimension queries.
   */
  async getBaselineStatus(
    userId: string,
  ): Promise<Map<BaselineDimension, boolean>> {
    const records = await this.prisma.userSuggestionBaseline.findMany({
      where: { userId },
    });

    const status = new Map<BaselineDimension, boolean>();
    for (const dim of Object.values(BaselineDimension)) {
      const record = records.find((r) => r.dimension === (dim as string));
      status.set(dim, record?.establishedAt != null);
    }
    return status;
  }

  /**
   * Records an observation for the given dimension and updates
   * the baseline if enough consecutive days have been collected.
   */
  async recordObservation(
    userId: string,
    dimension: BaselineDimension,
    value: number,
    date: string,
  ): Promise<void> {
    if (!Number.isFinite(value)) return;

    const day = this.parseObservationDate(date);
    if (day == null) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.userSuggestionBaselineObservation.createMany({
        data: {
          userId,
          dimension,
          localDate: day,
          value,
        },
        skipDuplicates: true,
      });

      // Count consecutive days of covered observations from the observation
      // table. This runs in the same transaction as the idempotent write so a
      // failed aggregate update rolls back the observation and can be retried.
      const consecutiveDays = await this.countConsecutiveDays(
        userId,
        dimension,
        day,
        tx,
      );
      const isEstablished = consecutiveDays >= BASELINE_MIN_DAYS;

      // The no-op update makes concurrent callers converge on one row without
      // allowing an older recompute to replace a newer aggregate.
      await tx.userSuggestionBaseline.upsert({
        where: { userId_dimension: { userId, dimension } },
        create: {
          userId,
          dimension,
          daysCollected: consecutiveDays,
          baselineValue: isEstablished ? value : null,
          establishedAt: isEstablished ? day : null,
        },
        update: { daysCollected: { increment: 0 } },
      });

      await tx.userSuggestionBaseline.updateMany({
        where: {
          userId,
          dimension,
          daysCollected: { lt: consecutiveDays },
        },
        data: { daysCollected: consecutiveDays },
      });

      if (isEstablished) {
        await tx.userSuggestionBaseline.updateMany({
          where: { userId, dimension, establishedAt: null },
          data: { baselineValue: value, establishedAt: day },
        });
      }
    });
  }

  /**
   * Records only collector-provided, sufficiently covered observations.
   * A missing or unknown value is not evidence of a real zero measurement.
   */
  async recordObservations(
    userId: string,
    localDate: string,
    signals: SuggestionSignal[],
  ): Promise<void> {
    for (const signal of signals) {
      const dimension = this.signalToDimension(signal);
      if (dimension == null) continue;

      const observedValue = signal.payload['observedValue'];
      const coverage = signal.payload['coverage'];
      if (
        typeof observedValue !== 'number' ||
        !Number.isFinite(observedValue) ||
        coverage == null ||
        typeof coverage !== 'object' ||
        (coverage as { sufficient?: unknown })['sufficient'] !== true
      ) {
        continue;
      }

      await this.recordObservation(userId, dimension, observedValue, localDate);
    }
  }

  /**
   * Counts consecutive days (ending today) where the user has
   * records of the relevant kind for the given dimension.
   */
  private async countConsecutiveDays(
    userId: string,
    dimension: BaselineDimension,
    endDate: Date,
    client: Prisma.TransactionClient,
  ): Promise<number> {
    const lookbackStart = new Date(endDate);
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 30); // look back up to 30 days

    const observations =
      await client.userSuggestionBaselineObservation.findMany({
        where: {
          userId,
          dimension,
          localDate: { gte: lookbackStart, lte: endDate },
        },
        select: { localDate: true },
      });

    const uniqueDates = new Set(
      observations.map((record) => record.localDate.toISOString().slice(0, 10)),
    );

    // Count consecutive days from endDate backwards
    let count = 0;
    const cursor = new Date(endDate);
    while (count < 30) {
      const dateKey = cursor.toISOString().slice(0, 10);
      if (uniqueDates.has(dateKey)) {
        count++;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      } else {
        break;
      }
    }

    return count;
  }

  private parseObservationDate(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = parseDateOnly(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10) === value ? parsed : null;
  }

  private signalToDimension(
    signal: SuggestionSignal,
  ): BaselineDimension | null {
    if (signal.source === 'record') {
      switch (signal.kind) {
        case 'water_count':
          return BaselineDimension.WATER_INTAKE;
        case 'sleep_record':
          return BaselineDimension.SLEEP_DURATION;
        case 'caffeine_trend':
          return BaselineDimension.CAFFEINE_INTAKE;
        case 'symptom_trend':
          return BaselineDimension.SYMPTOM_SEVERITY;
        case 'mood_trend':
          return BaselineDimension.MOOD;
        default:
          return null;
      }
    }

    return null;
  }
}
