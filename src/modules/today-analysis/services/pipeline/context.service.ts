import { parseDateOnly } from '../../../../common';
import {
  summarizeWaterMetrics,
  toObservedWaterMetric,
  WATER_TARGET_ML_PER_COUNT,
} from '../../../../common';
import type { ObservedMetric } from '../../../../common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { DoseLogStatus, DailyRecordKind } from '#generated/prisma/client';
import { PrismaService } from '../../../../prisma';
import { DailyRecordReaderPort } from '../../../daily-records';
import type { DailyRecordFact } from '../../../daily-records';
import { MedicineDoseLogReaderPort } from '../../../medicine-dose-logs';
import { MedicineReminderReaderPort } from '../../../medicine-reminders';
import type { MedicineReminderFact } from '../../../medicine-reminders';
import { parseMealRecordPayload } from '../../../daily-records';
import {
  USER_SETTING_KEYS,
  USER_SETTINGS_DEFAULTS,
} from '../../../user-settings';

const MAX_RECENT_RECORDS = 8;
const MAX_CURRENT_MEDICINE_NAMES = 5;

type TriggerDimension = 'water' | 'meal' | 'sleep' | 'mood';

export interface TodayAnalysisContext {
  date: string;
  water: {
    completedCount: number;
    targetCount: number;
    remainingCount: number;
    observedMetric?: ObservedMetric<number>;
  };
  medication: {
    medicineCount: number;
    pendingCount: number;
    nextDoseTimeLabel: string;
    nextMedicineName: string | null;
    currentMedicineNames: string[];
  };
  recordSummary: Array<{
    kind: string;
    count: number;
  }>;
  recentRecords: Array<{
    kind: string;
    title: string | null;
    value: string | null;
    unit: string | null;
    note: string | null;
    createdAt: string;
  }>;
  sleep: {
    status: 'ok' | 'insufficient_data';
    durationMinutes: number | null;
    quality: string | null;
    startAt: string | null;
    endAt: string | null;
    deepMinutes: number | null;
    lightMinutes: number | null;
    remMinutes: number | null;
  };
  lowRiskContext: {
    activeAllergyCount: number;
    currentMedicineCount: number;
  };
}

@Injectable()
export class TodayAnalysisContextService {
  private static readonly CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

  private readonly logger = new Logger(TodayAnalysisContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyRecordReader: DailyRecordReaderPort,
    private readonly doseLogReader: MedicineDoseLogReaderPort,
    private readonly reminderReader: MedicineReminderReaderPort,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async build(userId: string, date: string): Promise<TodayAnalysisContext> {
    const cacheKey = `today-analysis:context:${userId}:${date}`;
    let cached: TodayAnalysisContext | undefined;
    try {
      cached = await this.cache.get<TodayAnalysisContext>(cacheKey);
    } catch (error) {
      this.logger.warn(
        `Today analysis context cache get failed (key=${cacheKey}): ${String(error)}`,
      );
      throw error;
    }
    if (cached != null) {
      return cached;
    }

    const result = await this.fetchContext(userId, date);
    try {
      await this.cache.set(
        cacheKey,
        result,
        TodayAnalysisContextService.CACHE_TTL_MS,
      );
    } catch (error) {
      this.logger.warn(
        `Today analysis context cache set failed (key=${cacheKey}): ${String(error)}`,
      );
      throw error;
    }
    return result;
  }

  private async fetchContext(
    userId: string,
    date: string,
  ): Promise<TodayAnalysisContext> {
    const day = this.parseDate(date);
    const weekday = day.getUTCDay();

    const [
      currentMedicines,
      reminders,
      doseLogs,
      dailyRecords,
      activeAllergyCount,
      waterTargetCount,
    ] = await Promise.all([
      this.prisma.userCurrentMedicine.findMany({
        where: {
          userId,
          isCurrent: true,
        },
        select: {
          id: true,
          displayName: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }],
      }),
      this.reminderReader.listActiveFacts(userId),
      this.doseLogReader.listFactsInRange(userId, day, day),
      this.dailyRecordReader
        .listFactsInRange(userId, day, day)
        // Reader returns canonical `occurredAt asc, createdAt asc`; the
        // original query was `createdAt desc` (latest records first).
        .then((facts) =>
          facts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        ),
      this.prisma.userAllergy.count({
        where: {
          userId,
          isActive: true,
        },
      }),
      this.prisma.userSetting.findUnique({
        where: {
          userId_key: {
            userId,
            key: USER_SETTING_KEYS.waterTargetCount,
          },
        },
        select: { value: true },
      }),
    ]);

    const completedMedicineIds = new Set(
      doseLogs
        .filter(
          (log) =>
            log.currentMedicineId != null &&
            (log.status === DoseLogStatus.taken ||
              log.status === DoseLogStatus.skipped),
        )
        .map((log) => log.currentMedicineId)
        .filter((id): id is string => id != null),
    );

    const pendingMedicines = currentMedicines.filter(
      (medicine) => !completedMedicineIds.has(medicine.id),
    );
    const pendingMedicineIds = new Set(pendingMedicines.map((item) => item.id));
    const nextReminder = reminders.find((reminder) =>
      this.matchesDate(reminder, day, weekday, pendingMedicineIds),
    );
    const nextReminderMedicine = pendingMedicines.find(
      (medicine) => medicine.id === nextReminder?.currentMedicineId,
    );

    const waterSummary = summarizeWaterMetrics(
      dailyRecords
        .filter((record) => record.kind === DailyRecordKind.water)
        .map((record) => ({ value: record.value, unit: record.unit })),
    );
    const waterTarget =
      typeof waterTargetCount?.value === 'number' &&
      Number.isFinite(waterTargetCount.value)
        ? waterTargetCount.value
        : USER_SETTINGS_DEFAULTS.waterTargetCount;
    const observedWaterMetric = toObservedWaterMetric(waterSummary, day);
    const waterCompletedCount = waterSummary.observedCount;
    const waterRemainingCount =
      observedWaterMetric.state === 'observed' &&
      observedWaterMetric.value != null
        ? Math.max(
            Math.ceil(
              (waterTarget * WATER_TARGET_ML_PER_COUNT -
                observedWaterMetric.value) /
                WATER_TARGET_ML_PER_COUNT,
            ),
            0,
          )
        : 0;
    const recordSummary = this.buildRecordSummary(dailyRecords);
    const recentRecords = dailyRecords
      .slice(0, MAX_RECENT_RECORDS)
      .map((record) => this.toRecentRecord(record));
    const sleepData = this.buildSleepContext(dailyRecords);

    return {
      date,
      water: {
        completedCount: waterCompletedCount,
        targetCount: waterTarget,
        remainingCount: waterRemainingCount,
        observedMetric: observedWaterMetric,
      },
      medication: {
        medicineCount: currentMedicines.length,
        pendingCount: pendingMedicines.length,
        nextDoseTimeLabel: nextReminder
          ? this.toTimeLabel(
              nextReminder.scheduledHour,
              nextReminder.scheduledMinute,
            )
          : '--',
        nextMedicineName: nextReminderMedicine?.displayName ?? null,
        currentMedicineNames: currentMedicines
          .map((medicine) => medicine.displayName.trim())
          .filter((name) => name.length > 0)
          .slice(0, MAX_CURRENT_MEDICINE_NAMES),
      },
      recordSummary,
      recentRecords,
      sleep: sleepData,
      lowRiskContext: {
        activeAllergyCount,
        currentMedicineCount: currentMedicines.length,
      },
    };
  }

  private buildRecordSummary(dailyRecords: DailyRecordFact[]) {
    const counts = new Map<string, number>();
    for (const record of dailyRecords) {
      counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
    }

    return Array.from(counts.entries()).map(([kind, count]) => ({
      kind,
      count,
    }));
  }

  /**
   * Dimension-level gate for event-driven Today Analysis recompute.
   *
   * A daily-record change for water/meal/sleep/mood only triggers analysis when
   * either the dimension has accumulated enough signal in the last 7 days, or
   * today's value represents a sharp shift versus the prior 7-day baseline.
   */
  async shouldTriggerForDimension(
    userId: string,
    date: string,
    kind: TriggerDimension,
  ): Promise<boolean> {
    const day = this.parseDate(date);
    const start = new Date(day);
    start.setUTCDate(start.getUTCDate() - 13);
    const records = await this.dailyRecordReader.listFactsInRange(
      userId,
      start,
      day,
      [kind],
    );

    const last7Days = new Date(day);
    last7Days.setUTCDate(last7Days.getUTCDate() - 6);

    const recentRecords = records.filter((r) => r.occurredAt >= last7Days);
    const priorRecords = records.filter((r) => r.occurredAt < last7Days);

    const coverage = recentRecords.length;
    if (coverage >= 3) {
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
    return change >= 0.5;
  }

  private aggregateDimensionValue(
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
          .map((record) => this.parseMoodScore(record.value, record.title))
          .filter((score): score is number => score != null);
        if (scores.length === 0) return 0;
        return scores.reduce((sum, score) => sum + score, 0) / scores.length;
      }
      case DailyRecordKind.meal: {
        return records.filter((record) => this.isAnalyzedMeal(record)).length;
      }
      default:
        return records.length;
    }
  }

  private computeBaselineAverage(
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

  private isAnalyzedMeal(record: DailyRecordFact): boolean {
    const payload = parseMealRecordPayload(record.payload);
    const status = payload.mealAnalysis?.analysisStatus;
    return status === 'confirmed' || status === 'unconfirmed';
  }

  private parseMoodScore(
    value: string | null,
    title: string | null,
  ): number | null {
    if (value != null) {
      const num = Number(value);
      if (Number.isFinite(num) && num >= 1 && num <= 5) return num;
    }

    const text = (title ?? '').toLowerCase();
    if (
      text.includes('great') ||
      text.includes('很好') ||
      text.includes('开心')
    )
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

  // Sleep date convention: a sleep record's `occurredAt` is the wake date
  // (the morning the user wakes up). Querying by `occurredAt = day` returns
  // the sleep the user woke up on that calendar day.
  private buildSleepContext(dailyRecords: DailyRecordFact[]): {
    status: 'ok' | 'insufficient_data';
    durationMinutes: number | null;
    quality: string | null;
    startAt: string | null;
    endAt: string | null;
    deepMinutes: number | null;
    lightMinutes: number | null;
    remMinutes: number | null;
  } {
    const emptyResult = {
      status: 'insufficient_data' as const,
      durationMinutes: null,
      quality: null,
      startAt: null,
      endAt: null,
      deepMinutes: null,
      lightMinutes: null,
      remMinutes: null,
    };

    const sleepRecord = dailyRecords.find(
      (record) => record.kind === DailyRecordKind.sleep,
    );

    if (sleepRecord == null) {
      return emptyResult;
    }

    const payload = sleepRecord.payload as Record<string, unknown> | null;
    if (payload == null) {
      return emptyResult;
    }

    const durationMinutes =
      typeof payload['durationMinutes'] === 'number'
        ? payload['durationMinutes']
        : null;
    const quality =
      typeof payload['quality'] === 'string' ? payload['quality'] : null;
    const startAt =
      typeof payload['startAt'] === 'string' ? payload['startAt'] : null;
    const endAt =
      typeof payload['endAt'] === 'string' ? payload['endAt'] : null;
    const deepMinutes =
      typeof payload['deepMinutes'] === 'number'
        ? payload['deepMinutes']
        : null;
    const lightMinutes =
      typeof payload['lightMinutes'] === 'number'
        ? payload['lightMinutes']
        : null;
    const remMinutes =
      typeof payload['remMinutes'] === 'number' ? payload['remMinutes'] : null;

    return {
      status:
        durationMinutes != null && durationMinutes > 0
          ? 'ok'
          : 'insufficient_data',
      durationMinutes,
      quality,
      startAt,
      endAt,
      deepMinutes,
      lightMinutes,
      remMinutes,
    };
  }

  private toRecentRecord(record: DailyRecordFact) {
    const mealPresentation = this.toMealRecentRecord(record);
    if (mealPresentation != null) {
      return mealPresentation;
    }

    return {
      kind: record.kind,
      title: this.trimNullableText(record.title),
      value: this.trimNullableText(record.value),
      unit: this.trimNullableText(record.unit),
      note: this.trimNullableText(record.note),
      createdAt: record.createdAt.toISOString(),
    };
  }

  private toMealRecentRecord(record: DailyRecordFact) {
    if (record.kind !== DailyRecordKind.meal) {
      return null;
    }

    const payload = parseMealRecordPayload(record.payload);
    const analysis = payload.mealAnalysis;
    const status = analysis?.analysisStatus;

    // Keep analyzing meals as plain records so the LLM does not treat
    // unfinished results as available evidence.
    if (status === 'analyzing') {
      return null;
    }

    if (status === 'analysis_failed') {
      return {
        kind: record.kind,
        title: '饮食分析缺失',
        value: this.trimNullableText(record.value),
        unit: this.trimNullableText(record.unit),
        note: '未能识别饮食内容，缺少可使用的餐食分析数据',
        createdAt: record.createdAt.toISOString(),
      };
    }

    if (status !== 'unconfirmed' && status !== 'confirmed') {
      return null;
    }

    if (analysis == null) {
      return null;
    }

    const description = this.trimNullableText(analysis.mealDescription ?? null);
    const foodNames = Array.isArray(analysis.recognizedDishes)
      ? analysis.recognizedDishes
          .map((item) => {
            const candidate =
              typeof item.rawName === 'string'
                ? item.rawName
                : typeof item.normalizedDishName === 'string'
                  ? item.normalizedDishName
                  : null;
            return candidate?.trim() ?? null;
          })
          .filter((value): value is string => value != null && value.length > 0)
          .slice(0, 3)
      : Array.isArray(analysis.foodItems)
        ? analysis.foodItems
            .map((item) => {
              if (typeof item !== 'object') {
                return null;
              }
              const candidate = item['name'];
              return typeof candidate === 'string' ? candidate.trim() : null;
            })
            .filter(
              (value): value is string => value != null && value.length > 0,
            )
            .slice(0, 3)
        : [];

    const isPartial = analysis.coverage === 'partial';
    const estimateLabel =
      status === 'confirmed'
        ? isPartial
          ? '饮食已确认（部分匹配）'
          : '饮食已确认'
        : isPartial
          ? '饮食估算中（部分匹配）'
          : '饮食估算中';

    const noteParts: string[] = [];
    if (isPartial) {
      noteParts.push('部分估算');
    }
    if (foodNames.length > 0) {
      noteParts.push(`识别食物：${foodNames.join('、')}`);
    }
    const note =
      noteParts.length > 0
        ? noteParts.join(' · ')
        : this.trimNullableText(record.note);

    return {
      kind: record.kind,
      title:
        description == null
          ? this.trimNullableText(record.title)
          : `${estimateLabel}：${description}`,
      value: this.trimNullableText(record.value),
      unit: this.trimNullableText(record.unit),
      note,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private trimNullableText(value: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }

  private matchesDate(
    reminder: MedicineReminderFact,
    day: Date,
    weekday: number,
    pendingMedicineIds: Set<string>,
  ): boolean {
    if (
      reminder.currentMedicineId == null ||
      !pendingMedicineIds.has(reminder.currentMedicineId)
    ) {
      return false;
    }

    if (reminder.startDate != null && day < reminder.startDate) {
      return false;
    }
    if (reminder.endDate != null && day > reminder.endDate) {
      return false;
    }

    const daysOfWeek = this.parseDaysOfWeek(reminder.daysOfWeek);
    if (daysOfWeek == null) {
      return true;
    }

    return daysOfWeek.includes(weekday);
  }

  private parseDaysOfWeek(value: unknown): number[] | null {
    if (!Array.isArray(value)) {
      return null;
    }

    const days = value.filter((day): day is number => typeof day === 'number');
    return days.length > 0 ? days : null;
  }

  private toTimeLabel(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private parseDate(date: string): Date {
    return parseDateOnly(date);
  }
}
