import type {
  ReportDashboardDataDto,
  ReportMetricDto,
  ReportPatternDto,
  ReportTrendDto,
} from '../dto/report-dashboard-response.dto';
import type { ReportRange } from '../dto/report-dashboard-query.dto';
import type { ObservedMetric } from '../../../common';

export type MetricStatus =
  | 'good'
  | 'stable'
  | 'needs_attention'
  | 'insufficient_data';

export type MetricDirection = 'up' | 'down' | 'flat';

export type ObservedMedicationMetric = ObservedMetric<number> & {
  takenCount: number;
  skippedCount: number;
  unconfirmedCount: number;
  overdueUnconfirmedCount: number;
};

export interface ReportDashboardFacts {
  range: ReportRange;
  startDate: Date;
  endDate: Date;
  generatedAt: string;
  aiSummaryEnabled: boolean;
  medicationSeries: number[];
  waterSeries: number[];
  sleepSeries: number[];
  /** New sparse metric projections; scalar series remain for compatibility. */
  observedMedicationSeries?: ObservedMedicationMetric[];
  observedWaterSeries?: ObservedMetric<number>[];
  observedSleepSeries?: ObservedMetric<number>[];
  mealEstimateSeries: number[];
  mealEstimateTrackedDays: number;
  mealEstimateBreakdown: {
    confirmedDays: number;
    estimatedDays: number;
    partialDays: number;
    analyzingDays: number;
    failedDays: number;
  };
}

export interface ReportDashboardComputed {
  metrics: ReportMetricDto[];
  score: ReportDashboardDataDto['score'];
  trends: ReportTrendDto[];
  findings: ReportDashboardDataDto['findings'];
  patterns: ReportPatternDto[];
}
