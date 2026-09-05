import { Injectable } from '@nestjs/common';
import type { ObservedMetric } from '../../../common/index.js';
import type {
  ReportMetricDto,
  ReportObservedMetricDto,
  ReportTrendDto,
} from '../dto/report-dashboard-response.dto.js';
import type {
  MetricDirection,
  MetricStatus,
  ObservedMedicationMetric,
  ReportDashboardComputed,
  ReportDashboardFacts,
} from './metrics.types.js';
import { ReportsPresenterService } from './presenter.service.js';

type TrendKind = 'medication' | 'water' | 'sleep';
type TrendSource = 'manual' | 'health_platform' | 'reminder_plan' | 'derived';
type Coverage = 'sufficient' | 'partial' | 'none';

/** Trend data-source mapping per metric kind, table-driven for testability. */
const TREND_SOURCES: Record<TrendKind, TrendSource[]> = {
  medication: ['reminder_plan'],
  water: ['manual'],
  sleep: ['manual'],
};

@Injectable()
export class ReportsComputationService {
  constructor(private readonly presenter: ReportsPresenterService) {}

  compute(
    facts: ReportDashboardFacts,
    locale: string,
  ): ReportDashboardComputed {
    const waterSeries = this.buildPublicWaterSeries(facts);
    const medicationMetric = this.buildMedicationMetric(
      facts.medicationSeries,
      facts.observedMedicationSeries,
    );
    const waterMetric = this.buildWaterMetric(
      waterSeries,
      facts.observedWaterSeries,
    );
    const sleepMetric = this.buildSleepMetric(facts.sleepSeries);
    const metrics = [medicationMetric, waterMetric, sleepMetric];

    const medicationTrend = this.buildTrend(
      'medication',
      '%',
      medicationMetric.value,
      facts.medicationSeries,
      facts.observedMedicationSeries,
      facts.startDate,
      facts.endDate,
    );
    const waterTrend = this.buildTrend(
      'water',
      'L',
      waterMetric.value,
      waterSeries,
      facts.observedWaterSeries,
      facts.startDate,
      facts.endDate,
    );
    const sleepTrend = this.buildTrend(
      'sleep',
      'h',
      sleepMetric.value,
      facts.sleepSeries,
      facts.observedSleepSeries,
      facts.startDate,
      facts.endDate,
    );

    return {
      metrics,
      trends: [medicationTrend, waterTrend, sleepTrend],
      findings: this.presenter.buildFindings(
        {
          range: facts.range,
          medicationSeries: facts.medicationSeries,
          waterSeries,
          sleepStatus: sleepMetric.status,
        },
        locale,
      ),
      patterns: this.presenter.buildPatterns(
        {
          range: facts.range,
          medicationSeries: facts.medicationSeries,
          waterSeries,
          sleepSeries: facts.sleepSeries,
        },
        locale,
      ),
    };
  }

  private buildMedicationMetric(
    series: number[],
    observedSeries?: ObservedMedicationMetric[],
  ): ReportMetricDto {
    const values =
      observedSeries == null
        ? series.filter((value) => value > 0)
        : observedSeries.flatMap((metric) =>
            metric.state === 'observed' && metric.value != null
              ? [metric.value]
              : [],
          );
    if (values.length === 0) {
      return {
        kind: 'medication',
        value: '--',
        unit: '%',
        status: 'insufficient_data',
        delta: '--',
        direction: 'flat',
        sparkline: series,
      };
    }

    const average = Math.round(
      values.reduce((sum, value) => sum + value, 0) / values.length,
    );
    const status: MetricStatus =
      average >= 85 ? 'good' : average >= 60 ? 'stable' : 'needs_attention';

    return {
      kind: 'medication',
      value: String(average),
      unit: '%',
      status,
      delta: this.deltaPercent(series[0] ?? average, average),
      direction: this.compareDirection(series[0] ?? average, average),
      sparkline: series,
    };
  }

  private buildWaterMetric(
    series: number[],
    observedSeries?: ObservedMetric<number>[],
  ): ReportMetricDto {
    const values =
      observedSeries == null
        ? series
        : observedSeries
            .filter(
              (metric) =>
                metric.state === 'observed' &&
                metric.coverage === 'sufficient' &&
                metric.value != null,
            )
            .flatMap((metric) =>
              metric.value == null ? [] : [metric.value / 1000],
            );

    if (values.length === 0) {
      return {
        kind: 'water',
        value: '--',
        unit: 'L',
        status: 'insufficient_data',
        delta: '--',
        direction: 'flat',
        sparkline: series,
      };
    }

    const average =
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const roundedAverage = Number(average.toFixed(1));
    const status: MetricStatus =
      roundedAverage >= 1.8
        ? 'good'
        : roundedAverage >= 1.2
          ? 'stable'
          : 'needs_attention';

    return {
      kind: 'water',
      value: roundedAverage.toFixed(1),
      unit: 'L',
      status,
      delta: this.deltaNumber(values[0] ?? roundedAverage, roundedAverage, 1),
      direction: this.compareDirection(
        values[0] ?? roundedAverage,
        roundedAverage,
      ),
      sparkline: series,
    };
  }

  private buildPublicWaterSeries(facts: ReportDashboardFacts): number[] {
    if (facts.observedWaterSeries == null) {
      return facts.waterSeries;
    }

    return facts.observedWaterSeries
      .filter(
        (metric) =>
          metric.state === 'observed' &&
          metric.coverage === 'sufficient' &&
          metric.value != null,
      )
      .flatMap((metric) =>
        metric.value == null ? [] : [Number((metric.value / 1000).toFixed(2))],
      );
  }

  private buildSleepMetric(series: number[]): ReportMetricDto {
    const nonZeroDays = series.filter((value) => value > 0);
    if (nonZeroDays.length === 0) {
      return {
        kind: 'sleep',
        value: '--',
        unit: 'h',
        status: 'insufficient_data',
        delta: '--',
        direction: 'flat',
        sparkline: series,
      };
    }

    const average =
      nonZeroDays.reduce((sum, value) => sum + value, 0) / nonZeroDays.length;
    const roundedAverage = Number(average.toFixed(1));
    const status: MetricStatus =
      roundedAverage >= 7
        ? 'good'
        : roundedAverage >= 5
          ? 'stable'
          : 'needs_attention';

    return {
      kind: 'sleep',
      value: roundedAverage.toFixed(1),
      unit: 'h',
      status,
      delta: this.deltaNumber(series[0] ?? roundedAverage, roundedAverage, 1),
      direction: this.compareDirection(
        series[0] ?? roundedAverage,
        roundedAverage,
      ),
      sparkline: series,
    };
  }

  /**
   * Builds a trend DTO with observed-only values and an optional
   * observedMetric summary.
   *
   * When `observedSeries` is available, values are extracted from observed
   * days only (unknown days are omitted, not zero-filled). When it is not,
   * the scalar series is used as-is (sleep fallback).
   */
  private buildTrend(
    kind: TrendKind,
    unit: string,
    currentValue: string,
    scalarSeries: number[],
    observedSeries:
      | ObservedMetric<number>[]
      | ObservedMedicationMetric[]
      | undefined,
    windowStart: Date,
    windowEnd: Date,
  ): ReportTrendDto {
    if (observedSeries == null) {
      // No sparse series — fall back to scalar (sleep path).
      return { kind, unit, currentValue, values: scalarSeries };
    }

    const observedValues = observedSeries.flatMap((m) => {
      if (m.state !== 'observed' || m.value == null) return [];
      const v = m.value; // narrowed to number
      return [kind === 'water' ? Number((v / 1000).toFixed(2)) : v];
    });

    const observedCount = observedSeries.filter(
      (m) => m.state === 'observed',
    ).length;
    const expectedCount = observedSeries.length;

    const observedMetric: ReportObservedMetricDto = {
      value:
        observedValues.length > 0
          ? observedValues.reduce((a, b) => a + b, 0) / observedValues.length
          : null,
      state: observedCount > 0 ? 'observed' : 'unknown',
      coverage: this.classifyCoverage(observedCount, expectedCount),
      sources: TREND_SOURCES[kind],
      observedCount,
      expectedCount,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };

    return {
      kind,
      unit,
      currentValue,
      values: observedValues,
      observedMetric,
    };
  }

  private classifyCoverage(observed: number, expected: number): Coverage {
    if (observed === 0) return 'none';
    if (observed === expected) return 'sufficient';
    return 'partial';
  }

  private compareDirection(
    firstValue: number,
    currentValue: number,
  ): MetricDirection {
    const delta = currentValue - firstValue;
    if (Math.abs(delta) < 0.01) {
      return 'flat';
    }
    return delta > 0 ? 'up' : 'down';
  }

  private deltaPercent(firstValue: number, currentValue: number): string {
    if (firstValue <= 0) {
      return '--';
    }
    const delta = Math.round(currentValue - firstValue);
    const sign = delta >= 0 ? '+' : '';
    return `${sign}${String(delta)}%`;
  }

  private deltaNumber(
    firstValue: number,
    currentValue: number,
    fractionDigits: number,
  ): string {
    const delta = Number((currentValue - firstValue).toFixed(fractionDigits));
    const sign = delta >= 0 ? '+' : '';
    return sign + delta.toFixed(fractionDigits);
  }
}
