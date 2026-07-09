import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { nonDeleted } from '../../../../common/helpers/prisma.helpers';
import { parseDateOnly } from '../../../../common/helpers/date-time.utils';
import { DailyRecordKind } from '#generated/prisma/client';
import { BaselineDimension, BASELINE_MIN_DAYS } from '../../types';
import type { BaselineRecord } from '../../types';

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
    const day = parseDateOnly(date);
    const lookbackStart = new Date(day);
    lookbackStart.setUTCDate(
      lookbackStart.getUTCDate() - (BASELINE_MIN_DAYS - 1),
    );

    // Count consecutive days of records from the source data
    const consecutiveDays = await this.countConsecutiveDays(
      userId,
      dimension,
      day,
    );

    const existing = await this.prisma.userSuggestionBaseline.findUnique({
      where: {
        userId_dimension: { userId, dimension },
      },
    });

    const isEstablished = consecutiveDays >= BASELINE_MIN_DAYS;

    if (existing == null) {
      await this.prisma.userSuggestionBaseline.create({
        data: {
          userId,
          dimension,
          daysCollected: consecutiveDays,
          baselineValue: isEstablished ? value : null,
          establishedAt: isEstablished ? day : null,
        },
      });
    } else {
      await this.prisma.userSuggestionBaseline.update({
        where: { userId_dimension: { userId, dimension } },
        data: {
          daysCollected: consecutiveDays,
          baselineValue: isEstablished ? value : existing.baselineValue,
          establishedAt: isEstablished
            ? (existing.establishedAt ?? day)
            : existing.establishedAt,
        },
      });
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
  ): Promise<number> {
    const recordKind = this.dimensionToRecordKind(dimension);
    if (recordKind == null) return 0;

    const lookbackStart = new Date(endDate);
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 30); // look back up to 30 days

    const records = await this.prisma.userDailyRecord.findMany({
      where: {
        userId,
        ...nonDeleted,
        kind: recordKind,
        occurredAt: { gte: lookbackStart, lte: endDate },
      },
      select: { occurredAt: true },
      orderBy: { occurredAt: 'desc' },
    });

    // Deduplicate by date
    const uniqueDates = new Set(
      records.map((r) => r.occurredAt.toISOString().slice(0, 10)),
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

  private dimensionToRecordKind(
    dimension: BaselineDimension,
  ): DailyRecordKind | null {
    switch (dimension) {
      case BaselineDimension.WATER_INTAKE:
        return DailyRecordKind.water;
      case BaselineDimension.SLEEP_DURATION:
        return DailyRecordKind.sleep;
      case BaselineDimension.SYMPTOM_SEVERITY:
        return DailyRecordKind.symptom;
      case BaselineDimension.MOOD:
        return DailyRecordKind.mood;
      case BaselineDimension.CAFFEINE_INTAKE:
      case BaselineDimension.MEDICATION_ADHERENCE:
        return null; // These dimensions are tracked differently
      default:
        return null;
    }
  }
}
