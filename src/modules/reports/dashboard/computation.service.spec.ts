import { ReportsComputationService } from './computation.service';
import type { ReportsPresenterService } from './presenter.service';
import type { ReportDashboardFacts } from './types';

describe('ReportsComputationService', () => {
  let service: ReportsComputationService;
  let presenter: jest.Mocked<ReportsPresenterService>;

  beforeEach(() => {
    presenter = {
      buildScore: jest.fn().mockReturnValue({
        value: 80,
        maxValue: 100,
        status: 'stable',
        summary: 'Score summary',
      }),
      buildFindings: jest.fn().mockReturnValue([]),
      buildPatterns: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<ReportsPresenterService>;

    service = new ReportsComputationService(presenter);
  });

  const makeFacts = (
    overrides: Partial<ReportDashboardFacts> = {},
  ): ReportDashboardFacts => ({
    range: 'last_7_days',
    startDate: new Date('2026-07-04'),
    endDate: new Date('2026-07-10'),
    generatedAt: '2026-07-10T08:00:00.000Z',
    aiSummaryEnabled: false,
    medicationSeries: [80, 85, 90, 75, 60, 95, 100],
    waterSeries: [1.5, 2.0, 1.8, 1.2, 2.5, 1.9, 1.7],
    sleepSeries: [7, 6.5, 8, 5.5, 7.5, 6, 7],
    mealEstimateSeries: [0, 0, 0, 0, 0, 0, 0],
    mealEstimateTrackedDays: 0,
    mealEstimateBreakdown: {
      confirmedDays: 0,
      estimatedDays: 0,
      partialDays: 0,
      analyzingDays: 0,
      failedDays: 0,
    },
    ...overrides,
  });

  describe('compute', () => {
    it('builds metrics, score, trends, findings, and patterns', () => {
      const facts = makeFacts();
      const result = service.compute(facts, 'zh-CN');

      expect(result.metrics).toHaveLength(3);
      expect(result.metrics[0]!.kind).toBe('medication');
      expect(result.metrics[1]!.kind).toBe('water');
      expect(result.metrics[2]!.kind).toBe('sleep');

      expect(result.score).toEqual({
        value: 80,
        maxValue: 100,
        status: 'stable',
        summary: 'Score summary',
      });
      expect(presenter.buildScore).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(String)]),
        'zh-CN',
      );

      expect(result.trends).toHaveLength(3);
      expect(result.trends[0]!).toEqual({
        kind: 'medication',
        unit: '%',
        currentValue: expect.any(String),
        values: facts.medicationSeries,
      });
      expect(result.trends[1]!).toEqual({
        kind: 'water',
        unit: 'L',
        currentValue: expect.any(String),
        values: facts.waterSeries,
      });
      expect(result.trends[2]!).toEqual({
        kind: 'sleep',
        unit: 'h',
        currentValue: expect.any(String),
        values: facts.sleepSeries,
      });

      expect(presenter.buildFindings).toHaveBeenCalledWith(
        expect.objectContaining({ range: 'last_7_days' }),
        'zh-CN',
      );
      expect(presenter.buildPatterns).toHaveBeenCalledWith(
        expect.objectContaining({ range: 'last_7_days' }),
        'zh-CN',
      );
    });
  });

  describe('buildMedicationMetric', () => {
    it('returns insufficient_data when all values are zero', () => {
      const result = service.compute(
        makeFacts({ medicationSeries: [0, 0, 0, 0, 0, 0, 0] }),
        'en',
      );
      const medMetric = result.metrics[0]!;
      expect(medMetric.value).toBe('--');
      expect(medMetric.status).toBe('insufficient_data');
      expect(medMetric.delta).toBe('--');
      expect(medMetric.direction).toBe('flat');
    });

    it('returns good status when average >= 85', () => {
      const result = service.compute(
        makeFacts({ medicationSeries: [90, 90, 90, 90, 90, 90, 90] }),
        'en',
      );
      const medMetric = result.metrics[0]!;
      expect(medMetric.status).toBe('good');
      expect(medMetric.value).toBe('90');
    });

    it('returns stable status when average is between 60 and 84', () => {
      const result = service.compute(
        makeFacts({ medicationSeries: [70, 70, 70, 70, 70, 70, 70] }),
        'en',
      );
      const medMetric = result.metrics[0]!;
      expect(medMetric.status).toBe('stable');
      expect(medMetric.value).toBe('70');
    });

    it('returns needs_attention when average < 60', () => {
      const result = service.compute(
        makeFacts({ medicationSeries: [40, 40, 40, 40, 40, 40, 40] }),
        'en',
      );
      const medMetric = result.metrics[0]!;
      expect(medMetric.status).toBe('needs_attention');
    });

    it('computes delta and direction correctly', () => {
      const result = service.compute(
        makeFacts({ medicationSeries: [60, 80, 80, 80, 80, 80, 80] }),
        'en',
      );
      const medMetric = result.metrics[0]!;
      // average of non-zero [60,80,80,80,80,80,80] = 77 (rounds)
      // delta = 77 - 60 = +17
      expect(medMetric.direction).toBe('up');
    });
  });

  describe('buildWaterMetric', () => {
    it('returns good status when average >= 1.8', () => {
      const result = service.compute(
        makeFacts({ waterSeries: [2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0] }),
        'en',
      );
      const waterMetric = result.metrics[1]!;
      expect(waterMetric.status).toBe('good');
      expect(waterMetric.value).toBe('2.0');
    });

    it('returns stable status when average is between 1.2 and 1.7', () => {
      const result = service.compute(
        makeFacts({ waterSeries: [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5] }),
        'en',
      );
      const waterMetric = result.metrics[1]!;
      expect(waterMetric.status).toBe('stable');
    });

    it('returns needs_attention when average < 1.2', () => {
      const result = service.compute(
        makeFacts({ waterSeries: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] }),
        'en',
      );
      const waterMetric = result.metrics[1]!;
      expect(waterMetric.status).toBe('needs_attention');
    });
  });

  describe('buildSleepMetric', () => {
    it('returns insufficient_data when all values are zero', () => {
      const result = service.compute(
        makeFacts({ sleepSeries: [0, 0, 0, 0, 0, 0, 0] }),
        'en',
      );
      const sleepMetric = result.metrics[2]!;
      expect(sleepMetric.value).toBe('--');
      expect(sleepMetric.status).toBe('insufficient_data');
    });

    it('returns good status when average >= 7', () => {
      const result = service.compute(
        makeFacts({ sleepSeries: [8, 8, 8, 8, 8, 8, 8] }),
        'en',
      );
      const sleepMetric = result.metrics[2]!;
      expect(sleepMetric.status).toBe('good');
      expect(sleepMetric.value).toBe('8.0');
    });

    it('returns needs_attention when average < 5', () => {
      const result = service.compute(
        makeFacts({ sleepSeries: [4, 4, 4, 4, 4, 4, 4] }),
        'en',
      );
      const sleepMetric = result.metrics[2]!;
      expect(sleepMetric.status).toBe('needs_attention');
    });
  });

  describe('direction and delta', () => {
    it('flat direction when first value equals average', () => {
      const result = service.compute(
        makeFacts({ waterSeries: [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5] }),
        'en',
      );
      expect(result.metrics[1]!.direction).toBe('flat');
    });

    it('down direction when average is lower than first value', () => {
      const result = service.compute(
        makeFacts({ waterSeries: [3.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0] }),
        'en',
      );
      expect(result.metrics[1]!.direction).toBe('down');
    });
  });
});
