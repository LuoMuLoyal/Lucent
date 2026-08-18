import { formatDateOnly } from '../../../../common';
import type { ObservedMetric } from '../../../../common';
import { Injectable } from '@nestjs/common';
import type {
  ReportDashboardComputed,
  ReportDashboardFacts,
} from '../../dashboard/metrics.types';

export interface ReportsAiSummaryCoverageDimension {
  trackedDays: number;
  totalDays: number;
}

export interface ReportsAiSummaryContext {
  range: ReportDashboardFacts['range'];
  startDate: string;
  endDate: string;
  generatedAt: string;
  coverage: {
    medication: ReportsAiSummaryCoverageDimension;
    water: ReportsAiSummaryCoverageDimension;
    sleep: ReportsAiSummaryCoverageDimension;
  };
  metrics: Array<{
    kind: ReportDashboardComputed['metrics'][number]['kind'];
    value: string;
    unit: string;
    status: ReportDashboardComputed['metrics'][number]['status'];
    delta: string;
    direction: ReportDashboardComputed['metrics'][number]['direction'];
  }>;
  series: {
    medication: number[];
    water: number[];
    waterObserved?: ObservedMetric<number>[];
    sleep: number[];
    mealEstimate: number[];
  };
  mealEstimateBreakdown: {
    confirmedDays: number;
    estimatedDays: number;
    partialDays: number;
    analyzingDays: number;
    failedDays: number;
  };
}

@Injectable()
export class ReportsAiSummaryContextService {
  build(
    facts: ReportDashboardFacts,
    computed: ReportDashboardComputed,
  ): ReportsAiSummaryContext {
    const totalDays = facts.range === 'last_30_days' ? 30 : 7;

    const medicationTrackedDays =
      facts.observedMedicationSeries == null
        ? facts.medicationSeries.filter((value) => value > 0).length
        : facts.observedMedicationSeries.filter(
            (metric) => metric.state === 'observed' && metric.value != null,
          ).length;

    const waterTrackedDays =
      facts.observedWaterSeries == null
        ? facts.waterSeries.filter((value) => value > 0).length
        : facts.observedWaterSeries.filter(
            (metric) =>
              metric.state === 'observed' &&
              metric.coverage === 'sufficient' &&
              metric.value != null,
          ).length;

    const sleepTrackedDays = facts.sleepSeries.filter(
      (value) => value > 0,
    ).length;

    return {
      range: facts.range,
      startDate: formatDateOnly(facts.startDate),
      endDate: formatDateOnly(facts.endDate),
      generatedAt: facts.generatedAt,
      coverage: {
        medication: { trackedDays: medicationTrackedDays, totalDays },
        water: { trackedDays: waterTrackedDays, totalDays },
        sleep: { trackedDays: sleepTrackedDays, totalDays },
      },
      metrics: computed.metrics.map((metric) => ({
        kind: metric.kind,
        value: metric.value,
        unit: metric.unit,
        status: metric.status,
        delta: metric.delta,
        direction: metric.direction,
      })),
      series: {
        medication: facts.medicationSeries,
        water: facts.waterSeries,
        ...(facts.observedWaterSeries == null
          ? {}
          : { waterObserved: facts.observedWaterSeries }),
        sleep: facts.sleepSeries,
        mealEstimate: facts.mealEstimateSeries,
      },
      mealEstimateBreakdown: facts.mealEstimateBreakdown,
    };
  }
}
