import { Injectable } from '@nestjs/common';
import type { ReportMetricDto } from '../dto/report-dashboard-response.dto';
import type {
  MetricDirection,
  MetricStatus,
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
    const medicationMetric = this.buildMedicationMetric(facts.medicationSeries);
    const waterMetric = this.buildWaterMetric(facts.waterSeries);
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
          values: facts.waterSeries,
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
          waterSeries: facts.waterSeries,
          sleepStatus: sleepMetric.status,
        },
        locale,
      ),
      patterns: this.presenter.buildPatterns(
        {
          range: facts.range,
          medicationSeries: facts.medicationSeries,
          waterSeries: facts.waterSeries,
          sleepSeries: facts.sleepSeries,
        },
        locale,
      ),
    };
  }

  private buildMedicationMetric(series: number[]): ReportMetricDto {
    const nonZeroDays = series.filter((value) => value > 0);
    if (nonZeroDays.length === 0) {
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
      nonZeroDays.reduce((sum, value) => sum + value, 0) / nonZeroDays.length,
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

  private buildWaterMetric(series: number[]): ReportMetricDto {
    const average =
      series.reduce((sum, value) => sum + value, 0) /
      Math.max(series.length, 1);
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
      delta: this.deltaNumber(series[0] ?? roundedAverage, roundedAverage, 1),
      direction: this.compareDirection(
        series[0] ?? roundedAverage,
        roundedAverage,
      ),
      sparkline: series,
    };
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
