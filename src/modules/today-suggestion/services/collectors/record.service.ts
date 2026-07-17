import { Injectable } from '@nestjs/common';
import { parseDateOnly, now } from '../../../../common/helpers/date-time.utils';
import { DailyRecordKind } from '#generated/prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  DailyRecordReaderPort,
  type DailyRecordFact,
} from '../../../daily-records/repositories';
import type { SuggestionSignal } from '../../../today-suggestion/types';
import { TriggerType } from '../../../today-suggestion/types';
import {
  USER_SETTING_KEYS,
  USER_SETTINGS_DEFAULTS,
} from '../../../user-settings/constants/constants';
import { TREND_LOOKBACK_DAYS } from '../../../today-suggestion/constants';

/**
 * Collects daily-record signals: water count, sleep data,
 * symptom records (multi-day for trend), and mood records.
 */
@Injectable()
export class RecordCollectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyRecordReader: DailyRecordReaderPort,
  ) {}

  async collect(userId: string, date: string): Promise<SuggestionSignal[]> {
    const day = parseDateOnly(date);
    const lookbackStart = new Date(day);
    lookbackStart.setUTCDate(
      lookbackStart.getUTCDate() - (TREND_LOOKBACK_DAYS - 1),
    );

    const [todayFacts, multiDayRecords, waterTargetSetting] = await Promise.all(
      [
        this.dailyRecordReader.listFactsInRange(userId, day, day),
        this.dailyRecordReader.listFactsInRange(userId, lookbackStart, day),
        this.prisma.userSetting.findUnique({
          where: {
            userId_key: {
              userId,
              key: USER_SETTING_KEYS.waterTargetCount,
            },
          },
          select: { value: true },
        }),
      ],
    );

    // Reader returns canonical `occurredAt asc, createdAt asc`; the original
    // single-day query was `createdAt desc` (latest record wins on `.find`).
    const todayRecords = [...todayFacts].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    const signals: SuggestionSignal[] = [];

    // Water signal
    const waterRecords = todayRecords.filter(
      (r) => r.kind === DailyRecordKind.water,
    );
    const waterTarget =
      typeof waterTargetSetting?.value === 'number' &&
      Number.isFinite(waterTargetSetting.value)
        ? waterTargetSetting.value
        : USER_SETTINGS_DEFAULTS.waterTargetCount;

    signals.push({
      signalId: `rec_water_${date}`,
      source: 'record',
      kind: 'water_count',
      recordedAt: day,
      userId,
      triggerType: TriggerType.TIMER,
      payload: {
        completedCount: waterRecords.length,
        targetCount: waterTarget,
        remainingCount: Math.max(waterTarget - waterRecords.length, 0),
      },
    });

    // Multi-day water trend signal
    const multiDayWater = this.buildDailyCounts(
      multiDayRecords.filter((r) => r.kind === DailyRecordKind.water),
    );
    signals.push({
      signalId: `rec_water_trend_${date}`,
      source: 'record',
      kind: 'water_trend',
      recordedAt: day,
      userId,
      triggerType: TriggerType.TIMER,
      payload: {
        dailyCounts: multiDayWater,
        consecutiveDays: multiDayWater.length,
        targetCount: waterTarget,
      },
    });

    // Sleep signal
    const sleepRecord = todayRecords.find(
      (r) => r.kind === DailyRecordKind.sleep,
    );
    if (sleepRecord != null) {
      const payload = sleepRecord.payload as Record<string, unknown> | null;
      const durationMinutes =
        typeof payload?.['durationMinutes'] === 'number'
          ? payload['durationMinutes']
          : null;
      const quality =
        typeof payload?.['quality'] === 'string' ? payload['quality'] : null;

      signals.push({
        signalId: `rec_sleep_${date}`,
        source: 'record',
        kind: 'sleep_record',
        recordedAt: day,
        userId,
        triggerType: TriggerType.TIMER,
        payload: {
          durationMinutes,
          quality,
          recordId: sleepRecord.id,
        },
      });
    }

    // Multi-day sleep trend signal
    const multiDaySleep = multiDayRecords
      .filter((r) => r.kind === DailyRecordKind.sleep)
      .map((r) => {
        const payload = r.payload as Record<string, unknown> | null;
        return {
          date: r.occurredAt.toISOString().slice(0, 10),
          durationMinutes:
            typeof payload?.['durationMinutes'] === 'number'
              ? payload['durationMinutes']
              : null,
        };
      })
      .filter((s) => s.durationMinutes != null);

    if (multiDaySleep.length > 0) {
      signals.push({
        signalId: `rec_sleep_trend_${date}`,
        source: 'record',
        kind: 'sleep_trend',
        recordedAt: day,
        userId,
        triggerType: TriggerType.TIMER,
        payload: {
          dailyDurations: multiDaySleep,
          consecutiveDays: multiDaySleep.length,
        },
      });
    }

    // Symptom trend signal (for deteriorating_trend rule)
    const symptomRecords = multiDayRecords.filter(
      (r) => r.kind === DailyRecordKind.symptom,
    );
    if (symptomRecords.length > 0) {
      const symptomByDate = this.buildSymptomTrend(symptomRecords);
      signals.push({
        signalId: `rec_symptom_trend_${date}`,
        source: 'record',
        kind: 'symptom_trend',
        recordedAt: day,
        userId,
        triggerType: TriggerType.TIMER,
        payload: {
          byDate: symptomByDate,
          totalRecords: symptomRecords.length,
          uniqueDates: symptomByDate.length,
        },
      });
    }

    // Caffeine trend signal (for caffeine-sleep correlation rule)
    const caffeineRecords = multiDayRecords.filter(
      (r) => r.kind === DailyRecordKind.meal && r.title != null,
    );
    if (caffeineRecords.length > 0) {
      const caffeineByDate = this.buildCaffeineTrend(caffeineRecords);
      if (caffeineByDate.length > 0) {
        signals.push({
          signalId: `rec_caffeine_trend_${date}`,
          source: 'record',
          kind: 'caffeine_trend',
          recordedAt: day,
          userId,
          triggerType: TriggerType.TIMER,
          payload: {
            dailyIntakes: caffeineByDate,
            consecutiveDays: caffeineByDate.length,
          },
        });
      }
    }

    // Record density signal (for coverage rule)
    const recordKinds = new Set(todayRecords.map((r) => r.kind));
    signals.push({
      signalId: `rec_density_${date}`,
      source: 'record',
      kind: 'record_density',
      recordedAt: day,
      userId,
      triggerType: TriggerType.TIMER,
      payload: {
        todayCount: todayRecords.length,
        todayKinds: Array.from(recordKinds),
        multiDayCount: multiDayRecords.length,
        lookbackDays: TREND_LOOKBACK_DAYS,
      },
    });

    // Mood trend signal (for mood-sleep correlation rule)
    const moodRecords = multiDayRecords.filter(
      (r) => r.kind === DailyRecordKind.mood,
    );
    if (moodRecords.length > 0) {
      const moodByDate = this.buildMoodTrend(moodRecords);
      if (moodByDate.length > 0) {
        signals.push({
          signalId: `rec_mood_trend_${date}`,
          source: 'record',
          kind: 'mood_trend',
          recordedAt: day,
          userId,
          triggerType: TriggerType.TIMER,
          payload: {
            dailyMoods: moodByDate,
            consecutiveDays: moodByDate.length,
          },
        });
      }
    }

    return signals;
  }

  private buildDailyCounts(
    records: DailyRecordFact[],
  ): Array<{ date: string; count: number }> {
    const byDate = new Map<string, number>();
    for (const record of records) {
      const dateKey = record.occurredAt.toISOString().slice(0, 10);
      byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + 1);
    }
    return Array.from(byDate.entries()).map(([date, count]) => ({
      date,
      count,
    }));
  }

  private buildSymptomTrend(records: DailyRecordFact[]): Array<{
    date: string;
    title: string;
    value: string | null;
    note: string | null;
  }> {
    return records.map((r) => ({
      date: r.occurredAt.toISOString().slice(0, 10),
      title: r.title ?? '',
      value: r.value,
      note: r.note,
    }));
  }

  /** Returns the current time-of-day bucket for rule context. */
  static getTimeOfDay(
    date: Date = now(),
  ): 'morning' | 'afternoon' | 'evening' | 'night' {
    const hour = date.getUTCHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
  }

  /**
   * Builds a per-date summary of caffeine intake from meal records.
   * Infers caffeine from title/note containing coffee, tea, energy drink keywords.
   * Returns estimated intake count per date.
   */
  private buildCaffeineTrend(records: DailyRecordFact[]): Array<{
    date: string;
    count: number;
  }> {
    const byDate = new Map<string, number>();
    for (const record of records) {
      const title = record.title?.toLowerCase() ?? '';
      const note = record.note?.toLowerCase() ?? '';
      const isCaffeine =
        title.includes('coffee') ||
        title.includes('咖啡') ||
        title.includes('tea') ||
        title.includes('茶') ||
        title.includes('energy') ||
        title.includes('能量饮料') ||
        note.includes('coffee') ||
        note.includes('咖啡') ||
        note.includes('tea') ||
        note.includes('茶');
      if (!isCaffeine) continue;
      const dateKey = record.occurredAt.toISOString().slice(0, 10);
      byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + 1);
    }
    return Array.from(byDate.entries()).map(([date, count]) => ({
      date,
      count,
    }));
  }

  /**
   * Builds a per-date summary of mood from mood records.
   * Maps mood title/value to a numeric scale (1–5).
   */
  private buildMoodTrend(records: DailyRecordFact[]): Array<{
    date: string;
    moodScore: number;
    label: string;
  }> {
    const byDate = new Map<string, { moodScore: number; label: string }>();
    for (const record of records) {
      const dateKey = record.occurredAt.toISOString().slice(0, 10);
      const label = record.title ?? record.value ?? 'unknown';
      const moodScore = this.parseMoodScore(record.value, record.title);
      // Keep the latest entry per date (records are ordered asc by occurredAt)
      byDate.set(dateKey, { moodScore, label });
    }
    return Array.from(byDate.entries()).map(([date, entry]) => ({
      date,
      moodScore: entry.moodScore,
      label: entry.label,
    }));
  }

  /** Parses a mood score from value/title fields. Returns 1–5 scale. */
  private parseMoodScore(value: string | null, title: string | null): number {
    // Try numeric value first
    if (value != null) {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num >= 1 && num <= 5) return num;
    }

    // Try keyword mapping from title
    const text = (title ?? '').toLowerCase();
    if (
      text.includes('great') ||
      text.includes('很好') ||
      text.includes('开心')
    )
      return 5;
    if (text.includes('good') || text.includes('好') || text.includes('happy'))
      return 4;
    if (text.includes('ok') || text.includes('一般') || text.includes('normal'))
      return 3;
    if (
      text.includes('bad') ||
      text.includes('差') ||
      text.includes('sad') ||
      text.includes('低落')
    )
      return 2;
    if (
      text.includes('terrible') ||
      text.includes('很差') ||
      text.includes('awful')
    )
      return 1;

    return 3; // default neutral
  }
}
