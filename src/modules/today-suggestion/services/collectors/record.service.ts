import { Injectable } from '@nestjs/common';
import {
  parseDateOnly,
  now,
  parseWaterMetric,
  summarizeWaterMetrics,
  toObservedWaterMetric,
  WATER_TARGET_ML_PER_COUNT,
} from '../../../../common/index.js';
import { DailyRecordKind } from '#generated/prisma/client.js';
import { DailyRecordReaderPort } from '../../../daily-records/index.js';

import type { DailyRecordFact } from '../../../daily-records/index.js';
import type { SuggestionSignal } from '../../types/signal.types.js';
import { TriggerType } from '../../types/suggestion.types.js';
import { IUserSettingsPort } from '../../../user-settings/index.js';
import { TREND_LOOKBACK_DAYS } from '../../constants/thresholds.constants.js';
import type { ObservedMetric } from '../../../../common/index.js';

type SleepEpisode = {
  sleepType: 'nightSleep' | 'nap';
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number;
  quality: string | null;
  recordId: string;
};

type ParsedSleepEpisode = SleepEpisode & {
  startMs: number | null;
  endMs: number | null;
};

/**
 * Collects daily-record signals: water count, sleep data,
 * symptom records (multi-day for trend), and mood records.
 */
@Injectable()
export class RecordCollectorService {
  constructor(
    private readonly userSettingsService: IUserSettingsPort,
    private readonly dailyRecordReader: DailyRecordReaderPort,
  ) {}

  async collect(userId: string, date: string): Promise<SuggestionSignal[]> {
    const day = parseDateOnly(date);
    const lookbackStart = new Date(day);
    lookbackStart.setUTCDate(
      lookbackStart.getUTCDate() - (TREND_LOOKBACK_DAYS - 1),
    );

    const [todayFacts, multiDayRecords, settings] = await Promise.all([
      this.dailyRecordReader.listFactsInRange(userId, day, day),
      this.dailyRecordReader.listFactsInRange(userId, lookbackStart, day),
      this.userSettingsService.getSettings(userId),
    ]);

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
    const waterSummary = summarizeWaterMetrics(waterRecords);
    const observedWaterMetric = toObservedWaterMetric(waterSummary, day);
    const waterTarget = settings.waterTargetCount;

    signals.push({
      signalId: `rec_water_${date}`,
      source: 'record',
      kind: 'water_count',
      recordedAt: day,
      userId,
      triggerType: TriggerType.TIMER,
      payload: {
        // Keep the count fields for the existing rule/copy contract. The
        // canonical value is `observedMetric.value` in milliliters.
        completedCount: waterSummary.observedCount,
        targetCount: waterTarget,
        targetMl: waterTarget * WATER_TARGET_ML_PER_COUNT,
        targetSource: 'derived_from_legacy_count',
        remainingCount: Math.max(waterTarget - waterSummary.observedCount, 0),
        ...(waterSummary.observedCount > 0
          ? { observedValue: waterSummary.observedCount }
          : {}),
        ignoredCount: waterSummary.ignoredCount,
        observedMetric: observedWaterMetric,
        coverage: { sufficient: observedWaterMetric.state === 'observed' },
      },
    });

    // Multi-day water trend signal
    const multiDayWater = this.buildDailyCounts(
      multiDayRecords.filter(
        (r) =>
          r.kind === DailyRecordKind.water &&
          parseWaterMetric({ value: r.value, unit: r.unit }) != null,
      ),
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
        semantics: 'legacy_record_count',
        source: 'daily_record',
      },
    });

    // Sleep signal. Keep every episode; a nap must not replace night sleep.
    const sleepRecords = todayRecords.filter(
      (r) => r.kind === DailyRecordKind.sleep,
    );
    if (sleepRecords.length > 0) {
      const sleepSummary = this.buildSleepSummary(sleepRecords);
      const latestQuality =
        sleepSummary.episodes.find((episode) => episode.quality != null)
          ?.quality ?? null;

      signals.push({
        signalId: `rec_sleep_${date}`,
        source: 'record',
        kind: 'sleep_record',
        recordedAt: day,
        userId,
        triggerType: TriggerType.TIMER,
        payload: {
          durationMinutes: sleepSummary.allSleepDurationMinutes,
          nightDurationMinutes: sleepSummary.nightDurationMinutes,
          napDurationMinutes: sleepSummary.napDurationMinutes,
          allSleepDurationMinutes: sleepSummary.allSleepDurationMinutes,
          quality: latestQuality,
          recordId: sleepRecords[0]?.id,
          episodes: sleepSummary.episodes,
          observedMetric: sleepSummary.observedMetric,
          ...(sleepSummary.allSleepDurationMinutes > 0
            ? { observedValue: sleepSummary.allSleepDurationMinutes }
            : {}),
          ...(sleepSummary.dataQualityWarnings.length > 0
            ? { dataQualityWarnings: sleepSummary.dataQualityWarnings }
            : {}),
          coverage: {
            sufficient: sleepSummary.observedMetric.state === 'observed',
          },
        },
      });
    }

    // Multi-day sleep trend signal
    const multiDaySleep = this.buildSleepTrend(
      multiDayRecords.filter((r) => r.kind === DailyRecordKind.sleep),
    );

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
      const todaySymptom = [...symptomRecords]
        .reverse()
        .find((r) => r.occurredAt.toISOString().slice(0, 10) === date);
      const symptomObservedValue = this.parseNumericValue(
        todaySymptom?.value ?? null,
      );
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
          ...(symptomObservedValue != null
            ? { observedValue: symptomObservedValue }
            : {}),
          coverage: { sufficient: symptomObservedValue != null },
        },
      });
    }

    // Caffeine trend signal (for caffeine-sleep correlation rule)
    const caffeineRecords = multiDayRecords.filter(
      (r) =>
        r.kind === DailyRecordKind.meal &&
        ((r.title != null && r.title !== '') ||
          (r.note != null && r.note !== '')),
    );
    if (caffeineRecords.length > 0) {
      const caffeineByDate = this.buildCaffeineTrend(caffeineRecords);
      if (caffeineByDate.length > 0) {
        const todayCaffeine = caffeineByDate.find(
          (entry) => entry.date === date,
        )?.count;
        const mentionedRecordCount = caffeineByDate.reduce(
          (sum, entry) => sum + entry.count,
          0,
        );
        const mentionedDayCount = caffeineByDate.length;
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
            mentionedRecordCount,
            mentionedDayCount,
            ...(todayCaffeine != null && todayCaffeine > 0
              ? { observedValue: todayCaffeine }
              : {}),
            coverage: {
              sufficient: todayCaffeine != null && todayCaffeine > 0,
            },
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
        const todayMood = [...moodRecords]
          .reverse()
          .find((r) => r.occurredAt.toISOString().slice(0, 10) === date);
        const moodObservedValue = this.parseKnownMoodScore(
          todayMood?.value ?? null,
          todayMood?.title ?? null,
        );
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
            ...(moodObservedValue != null
              ? { observedValue: moodObservedValue }
              : {}),
            coverage: { sufficient: moodObservedValue != null },
          },
        });
      }
    }

    return signals;
  }

  private buildSleepSummary(records: DailyRecordFact[]): {
    episodes: SleepEpisode[];
    nightDurationMinutes: number;
    napDurationMinutes: number;
    allSleepDurationMinutes: number;
    observedMetric: ObservedMetric<number>;
    dataQualityWarnings: string[];
  } {
    const parsedEpisodes = records
      .map((record) => this.parseSleepEpisode(record))
      .filter((episode): episode is ParsedSleepEpisode => episode != null);
    const episodes = parsedEpisodes.map(
      ({ startMs: _startMs, endMs: _endMs, ...episode }) => episode,
    );
    const nightDurationMinutes = parsedEpisodes
      .filter((episode) => episode.sleepType === 'nightSleep')
      .reduce((sum, episode) => sum + episode.durationMinutes, 0);
    const napDurationMinutes = parsedEpisodes
      .filter((episode) => episode.sleepType === 'nap')
      .reduce((sum, episode) => sum + episode.durationMinutes, 0);
    const allSleepDurationMinutes = nightDurationMinutes + napDurationMinutes;
    const dataQualityWarnings: string[] = [];

    for (let index = 0; index < parsedEpisodes.length; index += 1) {
      const left = parsedEpisodes[index];
      if (left?.startMs == null || left.endMs == null) continue;
      for (
        let nextIndex = index + 1;
        nextIndex < parsedEpisodes.length;
        nextIndex += 1
      ) {
        const right = parsedEpisodes[nextIndex];
        if (
          right?.startMs != null &&
          right.endMs != null &&
          left.startMs < right.endMs &&
          right.startMs < left.endMs
        ) {
          dataQualityWarnings.push('sleep_episode_overlap');
          break;
        }
      }
      if (dataQualityWarnings.length > 0) break;
    }

    const windowStart = records[0]?.occurredAt ?? now();
    const windowEnd = new Date(windowStart);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);
    return {
      episodes,
      nightDurationMinutes,
      napDurationMinutes,
      allSleepDurationMinutes,
      observedMetric: {
        value: parsedEpisodes.length > 0 ? allSleepDurationMinutes : null,
        state: parsedEpisodes.length > 0 ? 'observed' : 'unknown',
        coverage: parsedEpisodes.length > 0 ? 'sufficient' : 'none',
        sources: parsedEpisodes.length > 0 ? ['manual'] : [],
        observedCount: parsedEpisodes.length,
        expectedCount: null,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
      },
      dataQualityWarnings,
    };
  }

  private buildSleepTrend(
    records: DailyRecordFact[],
  ): Array<{ date: string; durationMinutes: number }> {
    const byDate = new Map<string, DailyRecordFact[]>();
    for (const record of records) {
      const date = record.occurredAt.toISOString().slice(0, 10);
      const dayRecords = byDate.get(date) ?? [];
      dayRecords.push(record);
      byDate.set(date, dayRecords);
    }

    return Array.from(byDate.entries())
      .map(([date, dayRecords]) => ({
        date,
        durationMinutes:
          this.buildSleepSummary(dayRecords).allSleepDurationMinutes,
      }))
      .filter((entry) => entry.durationMinutes > 0);
  }

  private parseSleepEpisode(
    record: DailyRecordFact,
  ): ParsedSleepEpisode | null {
    const payload = record.payload as Record<string, unknown> | null;
    if (payload == null) return null;

    const sleepType = payload['sleepType'] === 'nap' ? 'nap' : 'nightSleep';
    const startedAt = this.stringOrNull(
      payload['startedAt'] ?? payload['startAt'],
    );
    const endedAt = this.stringOrNull(payload['endedAt'] ?? payload['endAt']);
    const startMs = this.parseTimestamp(startedAt);
    const endMs = this.parseTimestamp(endedAt);
    const durationValue = payload['durationMinutes'];
    const durationMinutes =
      typeof durationValue === 'number' &&
      Number.isFinite(durationValue) &&
      durationValue > 0
        ? durationValue
        : startMs != null && endMs != null && endMs > startMs
          ? Math.round((endMs - startMs) / 60_000)
          : null;
    if (durationMinutes == null) return null;

    return {
      sleepType,
      startedAt,
      endedAt,
      durationMinutes,
      quality: this.stringOrNull(payload['quality']),
      recordId: record.id,
      startMs,
      endMs,
    };
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private parseTimestamp(value: string | null): number | null {
    if (value == null) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
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
        note.includes('茶') ||
        note.includes('energy') ||
        note.includes('能量饮料');
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
      const moodScore = this.parseMoodScore(record.value, record.title);
      if (moodScore == null) continue;
      const dateKey = record.occurredAt.toISOString().slice(0, 10);
      const label = record.title ?? record.value ?? 'unknown';
      // Keep the latest entry per date (records are ordered asc by occurredAt)
      byDate.set(dateKey, { moodScore, label });
    }
    return Array.from(byDate.entries()).map(([date, entry]) => ({
      date,
      moodScore: entry.moodScore,
      label: entry.label,
    }));
  }

  /** Parses a mood score from value/title fields. Returns 1–5 scale or null. */
  private parseMoodScore(
    value: string | null,
    title: string | null,
  ): number | null {
    return this.parseKnownMoodScore(value, title);
  }

  private parseKnownMoodScore(
    value: string | null,
    title: string | null,
  ): number | null {
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

    return null;
  }

  private parseNumericValue(value: string | null): number | null {
    if (value == null || value.trim() === '') return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
  }
}
