import type {
  ReportDashboardDataDto,
  ReportMetricDto,
  ReportPatternDto,
  ReportTrendDto,
} from '../dto/report-dashboard-response.dto.js';
import type { ReportRange } from '../dto/report-dashboard-query.dto.js';
import type { ObservedMetric } from '../../../common/index.js';

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
  trends: ReportTrendDto[];
  findings: ReportDashboardDataDto['findings'];
  patterns: ReportPatternDto[];
}
