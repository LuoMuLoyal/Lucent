import { Injectable } from '@nestjs/common';
import { createDomainFailure } from '../../../common/result/index.js';
import { DomainFailureException } from '../../../common/result/domain-failure.exception.js';
import {
  summarizeWaterMetrics,
  toObservedWaterMetric,
} from '../../../common/index.js';
import {
  formatDateOnly,
  parseDateOnly,
  now,
  nowIsoString,
} from '../../../common/index.js';
import type {
  ObservedMetric,
  WaterMetricInput,
} from '../../../common/index.js';
import { DoseLogStatus, DailyRecordKind } from '#generated/prisma/client.js';
import { DailyRecordReaderPort } from '../../daily-records/index.js';
import { MedicineDoseLogReaderPort } from '../../medicine-dose-logs/index.js';
import { IUserSettingsPort } from '../../user-settings/index.js';
import {
  MealAnalysisStatus,
  parseMealRecordPayload,
} from '../../daily-records/index.js';
import {
  REPORT_RANGE_CUSTOM,
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
  type ReportDashboardQueryDto,
} from '../dto/report-dashboard-query.dto.js';
import type {
  ObservedMedicationMetric,
  ReportDashboardFacts,
} from './metrics.types.js';

@Injectable()
export class ReportsContextService {
  constructor(
    private readonly userSettingsService: IUserSettingsPort,
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

    const observedMedicationSeries = this.buildObservedMedicationSeries(
      doseLogs,
      startDate,
      endDate,
    );

    return {
      range,
      startDate,
      endDate,
      generatedAt: nowIsoString(),
      aiSummaryEnabled: settings.aiSummariesEnabled,
      // Scalar series remain for metric sparkline and presenter
      // (findings/patterns). Trend values are extracted from
      // observedMedicationSeries in computation.service.ts to
      // ensure unknown days are omitted, not zero-filled.
      medicationSeries: observedMedicationSeries.map((metric) =>
        metric.value == null ? 0 : metric.value,
      ),
      observedMedicationSeries,
      // Scalar water series for metric sparkline and presenter.
      // Trend values use observedWaterSeries directly (see computation).
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

  private buildObservedMedicationSeries(
    doseLogs: Array<{
      currentMedicineId: string | null;
      reminderId: string | null;
      scheduledFor: Date;
      scheduledTime: string | null;
      status: DoseLogStatus;
    }>,
    startDate: Date,
    endDate: Date,
  ): ObservedMedicationMetric[] {
    const slotsByDay = new Map<string, Map<string, DoseLogStatus>>();

    for (const log of doseLogs) {
      if (log.reminderId == null) continue;
      const day = this.toDateString(log.scheduledFor);
      const slotKey = [log.reminderId, day, log.scheduledTime ?? ''].join('|');
      const slots = slotsByDay.get(day) ?? new Map<string, DoseLogStatus>();
      const previous = slots.get(slotKey);
      if (
        previous == null ||
        this.medicationStatusPriority(log.status) >
          this.medicationStatusPriority(previous)
      ) {
        slots.set(slotKey, log.status);
      }
      slotsByDay.set(day, slots);
    }

    return this.eachDay(startDate, endDate).map((date) => {
      const day = this.toDateString(date);
      const statuses = [...(slotsByDay.get(day)?.values() ?? [])];
      const expectedCount = statuses.length > 0 ? statuses.length : null;
      const takenCount = statuses.filter(
        (status) => status === DoseLogStatus.taken,
      ).length;
      const skippedCount = statuses.filter(
        (status) => status === DoseLogStatus.skipped,
      ).length;
      const unconfirmedCount = statuses.filter(
        (status) => status === DoseLogStatus.planned,
      ).length;
      const overdueUnconfirmedCount = statuses.filter(
        (status) => status === DoseLogStatus.missed,
      ).length;
      const observedCount = takenCount + skippedCount;
      return {
        value:
          observedCount === 0 || expectedCount == null
            ? null
            : Number(((takenCount / expectedCount) * 100).toFixed(0)),
        state: observedCount === 0 ? 'unknown' : 'observed',
        coverage:
          observedCount === 0
            ? 'none'
            : observedCount === expectedCount
              ? 'sufficient'
              : 'partial',
        sources: expectedCount == null ? [] : ['reminder_plan'],
        observedCount,
        expectedCount,
        takenCount,
        skippedCount,
        unconfirmedCount,
        overdueUnconfirmedCount,
        windowStart: date.toISOString(),
        windowEnd: new Date(date.getTime() + 86_400_000).toISOString(),
      } satisfies ObservedMedicationMetric;
    });
  }

  private medicationStatusPriority(status: DoseLogStatus): number {
    if (status === DoseLogStatus.taken) return 4;
    if (status === DoseLogStatus.skipped) return 3;
    if (status === DoseLogStatus.missed) return 2;
    return 1;
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
    const endTime = endDate.getTime();
    for (
      let cursor = startDate.getTime();
      cursor <= endTime;
      cursor += 86_400_000
    ) {
      days.push(new Date(cursor));
    }
    return days;
  }

  private validationFailed(message: string): never {
    throw new DomainFailureException(
      createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        detail: message,
      }),
    );
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
        this.validationFailed('endDate is required when range is custom.');
      }
      const customEndDate = parseDateOnly(query.endDate);
      if (customEndDate > this.todayUtc()) {
        this.validationFailed('endDate must not be in the future.');
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
        this.validationFailed('startDate is required when range is custom.');
      }
      const startDate = parseDateOnly(query.startDate);
      if (startDate > endDate) {
        this.validationFailed('startDate must not be later than endDate.');
      }
      return startDate;
    }

    const startDate = new Date(endDate);
    const days = range === REPORT_RANGE_LAST_30_DAYS ? 30 : 7;
    startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
    return startDate;
  }
}
