import { formatDateOnly } from '../../../common/helpers/date-time.utils';
import { Injectable } from '@nestjs/common';
import type {
  ReportDashboardComputed,
  ReportDashboardFacts,
} from '../dashboard/reports.types';

export interface ReportsAiSummaryContext {
  range: ReportDashboardFacts['range'];
  startDate: string;
  endDate: string;
  generatedAt: string;
  score: {
    value: number;
    maxValue: number;
    status: ReportDashboardComputed['score']['status'];
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
    sleep: number[];
    mealEstimate: number[];
  };
  dataQuality: {
    medicationTrackedDays: number;
    waterTrackedDays: number;
    sleepTrackedDays: number;
    mealEstimateTrackedDays: number;
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
    return {
      range: facts.range,
      startDate: formatDateOnly(facts.startDate),
      endDate: formatDateOnly(facts.endDate),
      generatedAt: facts.generatedAt,
      score: {
        value: computed.score.value,
        maxValue: computed.score.maxValue,
        status: computed.score.status,
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
        sleep: facts.sleepSeries,
        mealEstimate: facts.mealEstimateSeries,
      },
      dataQuality: {
        medicationTrackedDays: facts.medicationSeries.filter(
          (value) => value > 0,
        ).length,
        waterTrackedDays: facts.waterSeries.filter((value) => value > 0).length,
        sleepTrackedDays: facts.sleepSeries.filter((value) => value > 0).length,
        mealEstimateTrackedDays: facts.mealEstimateTrackedDays,
      },
      mealEstimateBreakdown: facts.mealEstimateBreakdown,
    };
  }
}
