import { Injectable } from '@nestjs/common';
import {
  badRequest,
  summarizeWaterMetrics,
  toObservedWaterMetric,
} from '../../../common';
import {
  formatDateOnly,
  parseDateOnly,
  now,
  nowIsoString,
} from '../../../common';
import type { ObservedMetric, WaterMetricInput } from '../../../common';
import { DoseLogStatus, DailyRecordKind } from '#generated/prisma/client';
import { DailyRecordReaderPort } from '../../daily-records';
import { MedicineDoseLogReaderPort } from '../../medicine-dose-logs';
import { UserSettingsService } from '../../user-settings';
import {
  MealAnalysisStatus,
  parseMealRecordPayload,
} from '../../daily-records';
import {
  REPORT_RANGE_CUSTOM,
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
  type ReportDashboardQueryDto,
} from '../dto/report-dashboard-query.dto';
import type { ReportDashboardFacts } from './metrics.types';

@Injectable()
export class ReportsContextService {
  constructor(
    private readonly userSettingsService: UserSettingsService,
    private readonly dailyRecordReader: DailyRecordReaderPort,
    private readonly doseLogReader: MedicineDoseLogReaderPort,
  ) {}

  async build(
    userId: string,
    query: ReportDashboardQueryDto,
  ): Promise<ReportDashboardFacts> {
    const range = query.range ?? REPORT_RANGE_LAST_7_DAYS;
    const endDate = this.resolveEndDate(range, query);
    const startDate = this.resolveStartDate(endDate, range, query);

    const [settings, doseLogs, dailyRecords] = await Promise.all([
      this.userSettingsService.getSettings(userId),
      this.doseLogReader.listFactsInRange(userId, startDate, endDate),
      this.dailyRecordReader.listFactsInRange(userId, startDate, endDate),
    ]);

    const mealEstimateFacts = this.buildMealEstimateFacts(
      dailyRecords,
      startDate,
      endDate,
    );
    const observedWaterSeries = this.buildObservedWaterSeries(
      dailyRecords,
      startDate,
      endDate,
    );

    return {
      range,
      startDate,
      endDate,
      generatedAt: nowIsoString(),
      aiSummaryEnabled: settings.aiSummariesEnabled,
      medicationSeries: this.buildMedicationSeries(
        doseLogs,
        startDate,
        endDate,
      ),
      // Keep the scalar series for the existing report response until the
      // observed metric is promoted through the OpenAPI DTO. It is derived
      // from the same canonical ml observations below.
      waterSeries: observedWaterSeries.map((metric) =>
        metric.value == null ? 0 : Number((metric.value / 1000).toFixed(2)),
      ),
      observedWaterSeries,
      sleepSeries: this.buildSleepSeries(dailyRecords, startDate, endDate),
      mealEstimateSeries: mealEstimateFacts.series,
      mealEstimateTrackedDays: mealEstimateFacts.series.filter(
        (value) => value > 0,
      ).length,
      mealEstimateBreakdown: mealEstimateFacts.breakdown,
    };
  }

  private buildMedicationSeries(
    doseLogs: Array<{ scheduledFor: Date; status: DoseLogStatus }>,
    startDate: Date,
    endDate: Date,
  ): number[] {
    const plannedByDay = new Map<string, number>();
    const completedByDay = new Map<string, number>();

    for (const log of doseLogs) {
      const day = this.toDateString(log.scheduledFor);
      plannedByDay.set(day, (plannedByDay.get(day) ?? 0) + 1);
      if (log.status === DoseLogStatus.taken) {
        completedByDay.set(day, (completedByDay.get(day) ?? 0) + 1);
      }
    }

    return this.eachDay(startDate, endDate).map((date) => {
      const day = this.toDateString(date);
      const planned = plannedByDay.get(day) ?? 0;
      if (planned === 0) {
        return 0;
      }
      const completed = completedByDay.get(day) ?? 0;
      return Number(((completed / planned) * 100).toFixed(0));
    });
  }

  private buildObservedWaterSeries(
    dailyRecords: Array<{
      occurredAt: Date;
      kind: DailyRecordKind;
      value: string | null;
      unit: string | null;
    }>,
    startDate: Date,
    endDate: Date,
  ): ObservedMetric<number>[] {
    const recordsByDay = new Map<string, WaterMetricInput[]>();

    for (const record of dailyRecords) {
      if (record.kind !== DailyRecordKind.water) {
        continue;
      }

      const day = this.toDateString(record.occurredAt);
      const records = recordsByDay.get(day) ?? [];
      records.push({ value: record.value, unit: record.unit });
      recordsByDay.set(day, records);
    }

    return this.eachDay(startDate, endDate).map((date) => {
      const day = this.toDateString(date);
      const summary = summarizeWaterMetrics(recordsByDay.get(day) ?? []);
      return toObservedWaterMetric(summary, date);
    });
  }

  // Sleep date convention: `occurredAt` is the wake date. Each data point
  // in the sleep series represents the sleep the user woke up on that day.
  private buildSleepSeries(
    dailyRecords: Array<{
      occurredAt: Date;
      kind: DailyRecordKind;
      payload: unknown;
    }>,
    startDate: Date,
    endDate: Date,
  ): number[] {
    const durationByDay = new Map<string, number>();

    for (const record of dailyRecords) {
      if (record.kind !== DailyRecordKind.sleep) {
        continue;
      }

      const payload = record.payload as Record<string, unknown> | null;
      if (payload == null || typeof payload['durationMinutes'] !== 'number') {
        continue;
      }

      const hours = Number((payload['durationMinutes'] / 60).toFixed(1));
      if (hours <= 0) {
        continue;
      }

      const day = this.toDateString(record.occurredAt);
      durationByDay.set(day, hours);
    }

    return this.eachDay(startDate, endDate).map((date) => {
      return durationByDay.get(this.toDateString(date)) ?? 0;
    });
  }

  private buildMealEstimateFacts(
    dailyRecords: Array<{
      occurredAt: Date;
      kind: DailyRecordKind;
      payload: unknown;
    }>,
    startDate: Date,
    endDate: Date,
  ): {
    series: number[];
    breakdown: {
      confirmedDays: number;
      estimatedDays: number;
      partialDays: number;
      analyzingDays: number;
      failedDays: number;
    };
  } {
    const statusByDay = new Map<string, Set<MealAnalysisStatus>>();
    const partialByDay = new Set<string>();

    for (const record of dailyRecords) {
      if (record.kind !== DailyRecordKind.meal) {
        continue;
      }

      const payload = parseMealRecordPayload(record.payload);
      const status = payload.mealAnalysis?.analysisStatus;
      if (status == null) {
        continue;
      }

      const day = this.toDateString(record.occurredAt);
      const dayStatuses = statusByDay.get(day) ?? new Set<MealAnalysisStatus>();
      dayStatuses.add(status);
      statusByDay.set(day, dayStatuses);

      if (payload.mealAnalysis?.coverage === 'partial') {
        partialByDay.add(day);
      }
    }

    const series: number[] = [];
    let confirmedDays = 0;
    let estimatedDays = 0;
    let partialDays = 0;
    let analyzingDays = 0;
    let failedDays = 0;

    for (const date of this.eachDay(startDate, endDate)) {
      const day = this.toDateString(date);
      const statuses = statusByDay.get(day) ?? new Set<MealAnalysisStatus>();

      if (statuses.has('confirmed') || statuses.has('unconfirmed')) {
        series.push(1);
      } else {
        series.push(0);
      }

      if (statuses.has('confirmed')) {
        confirmedDays += 1;
      } else if (statuses.has('unconfirmed')) {
        estimatedDays += 1;
      } else if (statuses.has('analyzing')) {
        analyzingDays += 1;
      } else if (statuses.has('analysis_failed')) {
        failedDays += 1;
      }

      if (
        partialByDay.has(day) &&
        (statuses.has('confirmed') || statuses.has('unconfirmed'))
      ) {
        partialDays += 1;
      }
    }

    return {
      series,
      breakdown: {
        confirmedDays,
        estimatedDays,
        partialDays,
        analyzingDays,
        failedDays,
      },
    };
  }

  private eachDay(startDate: Date, endDate: Date): Date[] {
    const days: Date[] = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      days.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  private todayUtc(): Date {
    return parseDateOnly(formatDateOnly(now()));
  }

  private toDateString(date: Date): string {
    return formatDateOnly(date);
  }

  private resolveEndDate(
    range: ReportDashboardFacts['range'],
    query: ReportDashboardQueryDto,
  ): Date {
    if (range === REPORT_RANGE_CUSTOM) {
      if (!query.endDate) {
        badRequest('endDate is required when range is custom.');
      }
      const customEndDate = parseDateOnly(query.endDate);
      if (customEndDate > this.todayUtc()) {
        badRequest('endDate must not be in the future.');
      }
      return customEndDate;
    }
    return this.todayUtc();
  }

  private resolveStartDate(
    endDate: Date,
    range: ReportDashboardFacts['range'],
    query: ReportDashboardQueryDto,
  ): Date {
    if (range === REPORT_RANGE_CUSTOM) {
      if (!query.startDate) {
        badRequest('startDate is required when range is custom.');
      }
      const startDate = parseDateOnly(query.startDate);
      if (startDate > endDate) {
        badRequest('startDate must not be later than endDate.');
      }
      return startDate;
    }

    const startDate = new Date(endDate);
    const days = range === REPORT_RANGE_LAST_30_DAYS ? 30 : 7;
    startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
    return startDate;
  }
}
