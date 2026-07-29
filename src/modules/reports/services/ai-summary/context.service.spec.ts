import { ReportsAiSummaryContextService } from './context.service';
import type {
  ReportDashboardComputed,
  ReportDashboardFacts,
} from '../../dashboard/metrics.types';
import { REPORT_RANGE_LAST_7_DAYS } from '../../dto/report-dashboard-query.dto';

describe('ReportsAiSummaryContextService', () => {
  const service = new ReportsAiSummaryContextService();

  const baseFacts: ReportDashboardFacts = {
    range: REPORT_RANGE_LAST_7_DAYS,
    startDate: new Date('2026-06-06T00:00:00.000Z'),
    endDate: new Date('2026-06-12T00:00:00.000Z'),
    generatedAt: '2026-06-12T08:00:00.000Z',
    aiSummaryEnabled: true,
    medicationSeries: [100, 50, 100, 0, 100, 50, 100],
    waterSeries: [1.8, 1.4, 1.7, 1.2, 1.6, 1.1, 1.5],
    sleepSeries: [0, 0, 0, 0, 0, 0, 0],
    mealEstimateSeries: [1, 1, 0, 1, 0, 0, 1],
    mealEstimateTrackedDays: 4,
    mealEstimateBreakdown: {
      confirmedDays: 2,
      estimatedDays: 1,
      partialDays: 1,
      analyzingDays: 0,
      failedDays: 1,
    },
  };

  const baseComputed: ReportDashboardComputed = {
    score: {
      value: 78,
      maxValue: 100,
      status: 'stable',
      summary: '本周记录较完整。',
    },
    metrics: [
      {
        kind: 'medication',
        value: '83',
        unit: '%',
        status: 'stable',
        delta: '+17%',
        direction: 'up',
        sparkline: baseFacts.medicationSeries,
      },
      {
        kind: 'water',
        value: '1.5',
        unit: 'L',
        status: 'stable',
        delta: '-0.3',
        direction: 'down',
        sparkline: baseFacts.waterSeries,
      },
      {
        kind: 'sleep',
        value: '--',
        unit: 'h',
        status: 'insufficient_data',
        delta: '--',
        direction: 'flat',
        sparkline: baseFacts.sleepSeries,
      },
    ],
    trends: [],
    findings: [],
    patterns: [],
  };

  it('builds a summary context with meal estimate breakdown', () => {
    const context = service.build(baseFacts, baseComputed);

    expect(context.mealEstimateBreakdown).toEqual({
      confirmedDays: 2,
      estimatedDays: 1,
      partialDays: 1,
      analyzingDays: 0,
      failedDays: 1,
    });
  });

  it('passes the meal estimate series through to the AI context', () => {
    const context = service.build(baseFacts, baseComputed);

    expect(context.series.mealEstimate).toEqual(baseFacts.mealEstimateSeries);
    expect(context.dataQuality.mealEstimateTrackedDays).toBe(
      baseFacts.mealEstimateTrackedDays,
    );
  });
});
