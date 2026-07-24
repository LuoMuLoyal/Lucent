import { nonDeleted } from '../../../common';
import { parseDateOnly } from '../../../common';
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import {
  DoseLogStatus,
  DailyRecordKind,
  type Prisma,
} from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';
import { DailyRecordReaderPort } from '../../daily-records';
import type { DailyRecordFact } from '../../daily-records';
import { MedicineDoseLogReaderPort } from '../../medicine-dose-logs';
import { parseMealRecordPayload } from '../../daily-records';
import { USER_SETTING_KEYS, USER_SETTINGS_DEFAULTS } from '../../user-settings';

const MAX_RECENT_RECORDS = 8;
const MAX_CURRENT_MEDICINE_NAMES = 5;

const _reminderSelect = {
  currentMedicineId: true,
  scheduledHour: true,
  scheduledMinute: true,
  daysOfWeek: true,
  startDate: true,
  endDate: true,
  createdAt: true,
} satisfies Prisma.UserMedicineReminderSelect;

type ReminderShape = Prisma.UserMedicineReminderGetPayload<{
  select: typeof _reminderSelect;
}>;

export interface TodayAnalysisContext {
  date: string;
  water: {
    completedCount: number;
    targetCount: number;
    remainingCount: number;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyRecordReader: DailyRecordReaderPort,
    private readonly doseLogReader: MedicineDoseLogReaderPort,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async build(userId: string, date: string): Promise<TodayAnalysisContext> {
    const cacheKey = `today-analysis:context:${userId}:${date}`;
    const cached = await this.cache.get<TodayAnalysisContext>(cacheKey);
    if (cached != null) {
      return cached;
    }

    const result = await this.fetchContext(userId, date);
    await this.cache.set(
      cacheKey,
      result,
      TodayAnalysisContextService.CACHE_TTL_MS,
    );
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
      this.prisma.userMedicineReminder.findMany({
        where: {
          userId,
          isActive: true,
          ...nonDeleted,
        },
        select: {
          currentMedicineId: true,
          scheduledHour: true,
          scheduledMinute: true,
          daysOfWeek: true,
          startDate: true,
          endDate: true,
          createdAt: true,
        },
        orderBy: [
          { scheduledHour: 'asc' },
          { scheduledMinute: 'asc' },
          { createdAt: 'asc' },
        ],
      }),
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

    const waterCompletedCount = dailyRecords.filter(
      (record) => record.kind === 'water',
    ).length;
    const waterTarget =
      typeof waterTargetCount?.value === 'number' &&
      Number.isFinite(waterTargetCount.value)
        ? waterTargetCount.value
        : USER_SETTINGS_DEFAULTS.waterTargetCount;
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
        remainingCount: Math.max(waterTarget - waterCompletedCount, 0),
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
    reminder: ReminderShape,
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
