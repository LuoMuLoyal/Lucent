import { ReportsService } from './dashboard.service';
import {
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
} from '../dto/report-dashboard-query.dto';
import type { ReportsComputationService } from './computation.service';
import type { ReportsContextService } from './context.service';

describe('ReportsService', () => {
  it('builds a dashboard from facts and computed presentation', async () => {
    const contextService = {
      build: vi.fn().mockResolvedValue({
        range: REPORT_RANGE_LAST_7_DAYS,
        startDate: new Date('2026-06-06T00:00:00.000Z'),
        endDate: new Date('2026-06-12T00:00:00.000Z'),
        generatedAt: '2026-06-12T08:00:00.000Z',
        aiSummaryEnabled: true,
        medicationSeries: [50, 100, 0, 0, 0, 0, 0],
        waterSeries: [1.5, 0, 0, 0, 0, 0, 0],
        sleepSeries: [0, 0, 0, 0, 0, 0, 0],
        mealEstimateSeries: [1, 0, 0, 0, 0, 0, 0],
        mealEstimateTrackedDays: 1,
        mealEstimateBreakdown: {
          confirmedDays: 1,
          estimatedDays: 0,
          partialDays: 0,
          analyzingDays: 0,
          failedDays: 0,
        },
      }),
    } as unknown as ReportsContextService;
    const computationService = {
      compute: vi.fn().mockReturnValue({
        metrics: [
          {
            kind: 'medication',
            value: '75',
            unit: '%',
            status: 'stable',
            delta: '+25%',
            direction: 'up',
            sparkline: [50, 100, 0, 0, 0, 0, 0],
          },
          {
            kind: 'water',
            value: '0.2',
            unit: 'L',
            status: 'needs_attention',
            delta: '-1.3',
            direction: 'down',
            sparkline: [1.5, 0, 0, 0, 0, 0, 0],
          },
          {
            kind: 'sleep',
            value: '--',
            unit: 'h',
            status: 'insufficient_data',
            delta: '--',
            direction: 'flat',
            sparkline: [0, 0, 0, 0, 0, 0, 0],
          },
        ],
        trends: [
          {
            kind: 'medication',
            unit: '%',
            currentValue: '75',
            values: [50, 100, 0, 0, 0, 0, 0],
          },
          {
            kind: 'water',
            unit: 'L',
            currentValue: '0.2',
            values: [1.5, 0, 0, 0, 0, 0, 0],
          },
          {
            kind: 'sleep',
            unit: 'h',
            currentValue: '--',
            values: [0, 0, 0, 0, 0, 0, 0],
          },
        ],
        findings: [
          {
            kind: 'sleep',
            title: '睡眠数据不足',
            body: '当前还没有稳定的睡眠合同数据，暂不展示真实睡眠趋势。',
          },
        ],
        patterns: [
          {
            kind: 'sleep',
            title: '睡眠趋势',
            status: 'insufficient_data',
            body: '睡眠合同尚未接入真实持久化数据，当前仅保留缺失状态。',
            sparkline: [0, 0, 0, 0, 0, 0, 0],
          },
        ],
      }),
    } as unknown as ReportsComputationService;
    const cache = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    } as never;
    const service = new ReportsService(
      contextService,
      computationService,
      cache,
    );

    const dashboard = await service.getDashboard(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'en',
    );

    expect(dashboard.range).toBe(REPORT_RANGE_LAST_7_DAYS);
    expect(dashboard.metrics).toHaveLength(3);
    expect(dashboard.metrics[0]?.kind).toBe('medication');
    expect(dashboard.metrics[1]?.kind).toBe('water');
    expect(dashboard.metrics[2]?.kind).toBe('sleep');
    expect(dashboard.aiSummaryEnabled).toBe(true);
    expect(dashboard.trends[1]?.values[0]).toBe(1.5);
    expect(dashboard.findings.length).toBeGreaterThan(0);
    expect(contextService.build).toHaveBeenCalledWith('u1', {
      range: REPORT_RANGE_LAST_7_DAYS,
    });
    expect(computationService.compute).toHaveBeenCalledWith(
      expect.anything(),
      'en',
    );
  });

  it('passes 30-day range through to the context service', async () => {
    const contextService = {
      build: vi.fn().mockResolvedValue({
        range: REPORT_RANGE_LAST_30_DAYS,
        startDate: new Date('2026-05-14T00:00:00.000Z'),
        endDate: new Date('2026-06-12T00:00:00.000Z'),
        generatedAt: '2026-06-12T08:00:00.000Z',
        aiSummaryEnabled: true,
        medicationSeries: Array(30).fill(100),
        waterSeries: Array(30).fill(1.8),
        sleepSeries: Array(30).fill(0),
        mealEstimateSeries: Array(30).fill(1),
        mealEstimateTrackedDays: 30,
        mealEstimateBreakdown: {
          confirmedDays: 30,
          estimatedDays: 0,
          partialDays: 0,
          analyzingDays: 0,
          failedDays: 0,
        },
      }),
    } as unknown as ReportsContextService;
    const computationService = {
      compute: vi.fn().mockReturnValue({
        metrics: [],
        trends: [],
        findings: [],
        patterns: [],
      }),
    } as unknown as ReportsComputationService;
    const cache = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    } as never;
    const service = new ReportsService(
      contextService,
      computationService,
      cache,
    );

    const dashboard = await service.getDashboard(
      'u1',
      { range: REPORT_RANGE_LAST_30_DAYS },
      'zh-CN',
    );

    expect(dashboard.range).toBe(REPORT_RANGE_LAST_30_DAYS);
    expect(contextService.build).toHaveBeenCalledWith('u1', {
      range: REPORT_RANGE_LAST_30_DAYS,
    });
  });

  it('propagates sleep trend data through the dashboard', async () => {
    const sleepSeries = [7.5, 8.0, 6.5, 7.0, 8.0, 7.5, 7.0];
    const contextService = {
      build: vi.fn().mockResolvedValue({
        range: REPORT_RANGE_LAST_7_DAYS,
        startDate: new Date('2026-06-06T00:00:00.000Z'),
        endDate: new Date('2026-06-12T00:00:00.000Z'),
        generatedAt: '2026-06-12T08:00:00.000Z',
        aiSummaryEnabled: false,
        medicationSeries: Array(7).fill(0),
        waterSeries: Array(7).fill(0),
        sleepSeries,
        mealEstimateSeries: Array(7).fill(0),
        mealEstimateTrackedDays: 0,
        mealEstimateBreakdown: {
          confirmedDays: 0,
          estimatedDays: 0,
          partialDays: 0,
          analyzingDays: 0,
          failedDays: 0,
        },
      }),
    } as unknown as ReportsContextService;
    const computationService = {
      compute: vi.fn().mockReturnValue({
        metrics: [
          {
            kind: 'sleep',
            value: '7.4',
            unit: 'h',
            status: 'good',
            delta: '-0.5',
            direction: 'down',
            sparkline: sleepSeries,
          },
        ],
        trends: [
          {
            kind: 'sleep',
            unit: 'h',
            currentValue: '7.4',
            values: sleepSeries,
          },
        ],
        findings: [],
        patterns: [
          {
            kind: 'sleep',
            title: 'Sleep trend',
            status: 'good',
            body: 'Sleep averaged 7.4h over the last 7 days.',
            sparkline: sleepSeries,
          },
        ],
      }),
    } as unknown as ReportsComputationService;
    const cache = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    } as never;
    const service = new ReportsService(
      contextService,
      computationService,
      cache,
    );

    const dashboard = await service.getDashboard(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'en',
    );

    expect(dashboard.trends).toHaveLength(1);
    expect(dashboard.trends[0]?.kind).toBe('sleep');
    expect(dashboard.trends[0]?.values).toEqual(sleepSeries);
    expect(dashboard.metrics[0]?.status).toBe('good');
    expect(dashboard.patterns[0]?.status).toBe('good');
  });
});
