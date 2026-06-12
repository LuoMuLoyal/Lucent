import type {
  ReportDashboardDataDto,
  ReportMetricDto,
  ReportPatternDto,
  ReportRange,
  ReportTrendDto,
} from './dto';

export type MetricStatus =
  | 'good'
  | 'stable'
  | 'needs_attention'
  | 'insufficient_data';

export type MetricDirection = 'up' | 'down' | 'flat';

export interface ReportDashboardFacts {
  range: ReportRange;
  startDate: Date;
  endDate: Date;
  generatedAt: string;
  aiSummaryEnabled: boolean;
  medicationSeries: number[];
  waterSeries: number[];
  sleepSeries: number[];
}

export interface ReportDashboardComputed {
  metrics: ReportMetricDto[];
  score: ReportDashboardDataDto['score'];
  trends: ReportTrendDto[];
  findings: ReportDashboardDataDto['findings'];
  patterns: ReportPatternDto[];
}
