import { Injectable } from '@nestjs/common';
import type { ObservedMetric } from '../../../common';
import type { ReportMetricDto } from '../dto/report-dashboard-response.dto';
import type {
  MetricDirection,
  MetricStatus,
  ObservedMedicationMetric,
  ReportDashboardComputed,
  ReportDashboardFacts,
} from './metrics.types';
import { ReportsPresenterService } from './presenter.service';

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

    return {
      metrics,
      score: this.presenter.buildScore(this.buildScoreStatus(metrics), locale),
      trends: [
        {
          kind: 'medication',
          unit: '%',
          currentValue: medicationMetric.value,
          values: facts.medicationSeries,
        },
        {
          kind: 'water',
          unit: 'L',
          currentValue: waterMetric.value,
          values: waterSeries,
        },
        {
          kind: 'sleep',
          unit: 'h',
          currentValue: sleepMetric.value,
          values: facts.sleepSeries,
        },
      ],
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

  private buildScoreStatus(metrics: ReportMetricDto[]): MetricStatus[] {
    return metrics.map((metric) => metric.status);
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
    return sign + delta.toString() + '%';
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
