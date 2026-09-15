import { Injectable } from '@nestjs/common';
import {
  parseDateOnly,
  now,
  parseWaterMetric,
  summarizeWaterMetrics,
  toObservedWaterMetric,
  WATER_TARGET_ML_PER_COUNT,
} from '../../../../common/index.js';
import {
  DailyRecordKind,
  MealAnalysisStatus,
} from '#generated/prisma/client.js';
import {
  DailyRecordReaderPort,
  parseMealRecordPayload,
} from '../../../daily-records/index.js';

import type {
  DailyRecordFact,
  MealAnalysisFacetLevel,
  MealAnalysisItemKind,
} from '../../../daily-records/index.js';
import type { SuggestionSignal } from '../../types/signal.types.js';
import { TriggerType } from '../../types/suggestion.types.js';
import { IUserSettingsPort } from '../../../user-settings/index.js';
import { TREND_LOOKBACK_DAYS } from '../../constants/thresholds.constants.js';
import { symptomSeverityScore } from '../../constants/symptom-severity.constants.js';
import { SleepTrendBuilderService } from './sleep-trend-builder.service.js';

/**
 * 合并同一天同一维度的档位：取离 `ok` 最远的一档；`low` 与 `high` 并列时取 `high`。
 * 只影响「这一天该维度算不算值得留意」，不参与任何数值计算。
 */
function mergeFacetLevel(
  current: MealAnalysisFacetLevel | undefined,
  next: MealAnalysisFacetLevel,
): MealAnalysisFacetLevel {
  if (current == null || current === next) return next;
  if (current === 'ok') return next;
  if (next === 'ok') return current;
  return 'high';
}

/**
 * Collects daily-record signals: water count, sleep data,
 * symptom records (multi-day for trend), and mood records.
 */
@Injectable()
export class RecordCollectorService {
  constructor(
    private readonly userSettingsService: IUserSettingsPort,
    private readonly dailyRecordReader: DailyRecordReaderPort,
    private readonly sleepTrendBuilder: SleepTrendBuilderService,
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
      const sleepSummary =
        this.sleepTrendBuilder.buildSleepSummary(sleepRecords);
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
    const multiDaySleep = this.sleepTrendBuilder.buildSleepTrend(
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
        .toReversed()
        .find((r) => r.occurredAt.toISOString().slice(0, 10) === date);
      const symptomObservedValue = symptomSeverityScore(
        (todaySymptom?.payload as Record<string, unknown> | null)?.['severity'],
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

    // Diet facets signal (for the diet-imbalance rule).
    //
    // 机器语义只来自餐食分析的 `facets`（投影列判 `analyzed`，payload 只取 facets）：
    // 以前这里靠 title/note 里的「咖啡/茶/energy」关键词猜咖啡因摄入，与已删除的症状
    // 严重度启发式同病——换语言、换说法、模型改名都会让信号凭空消失或误报。
    const analyzedMealFacts = multiDayRecords.filter(
      (r) =>
        r.kind === DailyRecordKind.meal &&
        r.mealAnalysisStatus === MealAnalysisStatus.analyzed,
    );
    if (analyzedMealFacts.length > 0) {
      const dailyFacets = this.buildDailyFacets(analyzedMealFacts);
      signals.push({
        signalId: `rec_diet_facets_${date}`,
        source: 'record',
        kind: 'diet_facets',
        recordedAt: day,
        userId,
        triggerType: TriggerType.TIMER,
        payload: {
          dailyFacets,
          daysWithAnalyzedMeals: dailyFacets.length,
          analyzedMealCount: analyzedMealFacts.length,
          windowDays: TREND_LOOKBACK_DAYS,
          coverage: { sufficient: dailyFacets.length > 0 },
        },
      });
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
          .toReversed()
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
    symptom: string | null;
    severity: string | null;
    title: string;
    value: string | null;
  }> {
    return records.map((r) => {
      const payload = r.payload as Record<string, unknown> | null;
      return {
        date: r.occurredAt.toISOString().slice(0, 10),
        symptom: this.readString(payload?.['symptom']),
        severity: this.readString(payload?.['severity']),
        title: r.title ?? '',
        value: r.value,
      };
    });
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
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
   * Builds per-date facet levels from analyzed meal records.
   *
   * 同一天有多餐时合并同一维度的档位：取离 `ok` 最远的一档，`low` 与 `high` 并列时取
   * `high`——宁可提示「这天有一餐偏油炸」，也不因为平均而把值得留意的一餐抹平。
   * 只读餐食分析里已经收敛过的封闭词表，不做任何文本判断。
   */
  private buildDailyFacets(records: DailyRecordFact[]): Array<{
    date: string;
    analyzedMeals: number;
    facets: Partial<Record<MealAnalysisItemKind, MealAnalysisFacetLevel>>;
  }> {
    const byDate = new Map<
      string,
      {
        analyzedMeals: number;
        facets: Partial<Record<MealAnalysisItemKind, MealAnalysisFacetLevel>>;
      }
    >();

    for (const record of records) {
      const facets = parseMealRecordPayload(record.payload).mealAnalysis
        ?.facets;
      if (facets == null) continue;

      const dateKey = record.occurredAt.toISOString().slice(0, 10);
      const entry = byDate.get(dateKey) ?? { analyzedMeals: 0, facets: {} };
      entry.analyzedMeals += 1;
      for (const [kind, level] of Object.entries(facets)) {
        const current = entry.facets[kind as MealAnalysisItemKind];
        entry.facets[kind as MealAnalysisItemKind] = mergeFacetLevel(
          current,
          level,
        );
      }
      byDate.set(dateKey, entry);
    }

    return Array.from(byDate.entries())
      .map(([date, entry]) => ({ date, ...entry }))
      .sort((left, right) => left.date.localeCompare(right.date));
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
}
