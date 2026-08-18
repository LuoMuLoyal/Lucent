import { ReportsComputationService } from './computation.service';
import type { ObservedMetric } from '../../../common';
import type { ReportsPresenterService } from './presenter.service';
import type { ReportDashboardFacts } from './metrics.types';

describe('ReportsComputationService', () => {
  let service: ReportsComputationService;
  let presenter: vi.Mocked<ReportsPresenterService>;

  beforeEach(() => {
    presenter = {
      buildFindings: vi.fn().mockReturnValue([]),
      buildPatterns: vi.fn().mockReturnValue([]),
    } as unknown as vi.Mocked<ReportsPresenterService>;

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
    it('builds metrics, trends, findings, and patterns', () => {
      const facts = makeFacts();
      const result = service.compute(facts, 'zh-CN');

      expect(result.metrics).toHaveLength(3);
      expect(result.metrics[0]!.kind).toBe('medication');
      expect(result.metrics[1]!.kind).toBe('water');
      expect(result.metrics[2]!.kind).toBe('sleep');

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

    it('uses observed water values for every user-visible water series', () => {
      const observedWaterSeries: ObservedMetric<number>[] = [
        {
          value: 0,
          state: 'observed',
          coverage: 'sufficient',
          sources: ['manual'],
          observedCount: 1,
          expectedCount: null,
          windowStart: '2026-07-04T00:00:00.000Z',
          windowEnd: '2026-07-05T00:00:00.000Z',
        },
        {
          value: null,
          state: 'unknown',
          coverage: 'none',
          sources: [],
          observedCount: 0,
          expectedCount: null,
          windowStart: '2026-07-05T00:00:00.000Z',
          windowEnd: '2026-07-06T00:00:00.000Z',
        },
        {
          value: 2000,
          state: 'observed',
          coverage: 'sufficient',
          sources: ['manual'],
          observedCount: 1,
          expectedCount: null,
          windowStart: '2026-07-06T00:00:00.000Z',
          windowEnd: '2026-07-07T00:00:00.000Z',
        },
      ];

      const result = service.compute(
        makeFacts({
          waterSeries: [0, 0, 0],
          observedWaterSeries,
        }),
        'en',
      );

      expect(
        result.metrics.find((metric) => metric.kind === 'water')?.sparkline,
      ).toEqual([0, 2]);
      expect(
        result.trends.find((trend) => trend.kind === 'water')?.values,
      ).toEqual([0, 2]);
      expect(presenter.buildFindings).toHaveBeenCalledWith(
        expect.objectContaining({ waterSeries: [0, 2] }),
        'en',
      );
      expect(presenter.buildPatterns).toHaveBeenCalledWith(
        expect.objectContaining({ waterSeries: [0, 2] }),
        'en',
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

    it.each([
      {
        name: 'taken/taken',
        statuses: {
          takenCount: 2,
          skippedCount: 0,
          unconfirmedCount: 0,
          overdueUnconfirmedCount: 0,
        },
        value: 100,
        coverage: 'sufficient' as const,
        status: 'good' as const,
      },
      {
        name: 'taken/skipped',
        statuses: {
          takenCount: 1,
          skippedCount: 1,
          unconfirmedCount: 0,
          overdueUnconfirmedCount: 0,
        },
        value: 50,
        coverage: 'sufficient' as const,
        status: 'needs_attention' as const,
      },
      {
        name: 'taken/unconfirmed',
        statuses: {
          takenCount: 1,
          skippedCount: 0,
          unconfirmedCount: 1,
          overdueUnconfirmedCount: 0,
        },
        value: 50,
        coverage: 'partial' as const,
        status: 'needs_attention' as const,
      },
      {
        name: 'skipped/unconfirmed',
        statuses: {
          takenCount: 0,
          skippedCount: 1,
          unconfirmedCount: 1,
          overdueUnconfirmedCount: 0,
        },
        value: 0,
        coverage: 'partial' as const,
        status: 'needs_attention' as const,
      },
    ])(
      '$name keeps slot states isolated',
      ({ statuses, value, coverage, status }) => {
        const result = service.compute(
          makeFacts({
            medicationSeries: [0],
            observedMedicationSeries: [
              {
                value,
                state: 'observed',
                coverage,
                sources: ['reminder_plan'],
                observedCount:
                  statuses.takenCount +
                  statuses.skippedCount +
                  statuses.overdueUnconfirmedCount,
                expectedCount: 2,
                windowStart: '2026-06-06T00:00:00.000Z',
                windowEnd: '2026-06-07T00:00:00.000Z',
                ...statuses,
              },
            ],
          }),
          'en',
        );

        expect(result.metrics[0]).toMatchObject({
          value: String(value),
          status,
        });
      },
    );

    it('returns insufficient data for an all-unknown medication window', () => {
      const result = service.compute(
        makeFacts({
          medicationSeries: [0],
          observedMedicationSeries: [
            {
              value: null,
              state: 'unknown',
              coverage: 'none',
              sources: [],
              observedCount: 0,
              expectedCount: null,
              takenCount: 0,
              skippedCount: 0,
              unconfirmedCount: 0,
              overdueUnconfirmedCount: 0,
              windowStart: '2026-06-06T00:00:00.000Z',
              windowEnd: '2026-06-07T00:00:00.000Z',
            },
          ],
        }),
        'en',
      );

      expect(result.metrics[0]).toMatchObject({
        value: '--',
        status: 'insufficient_data',
      });
    });
  });

  describe('buildWaterMetric', () => {
    const observed = (
      value: number | null,
      state: 'observed' | 'unknown',
      coverage: 'sufficient' | 'partial' | 'none',
    ): ObservedMetric<number> => ({
      value,
      state,
      coverage,
      sources: state === 'observed' ? ['manual'] : [],
      observedCount: state === 'observed' ? 1 : 0,
      expectedCount: null,
      windowStart: '2026-07-04T00:00:00.000Z',
      windowEnd: '2026-07-11T00:00:00.000Z',
    });

    it('returns insufficient_data when all days are unknown', () => {
      const result = service.compute(
        makeFacts({
          waterSeries: [0, 0, 0],
          observedWaterSeries: [
            observed(null, 'unknown', 'none'),
            observed(null, 'unknown', 'none'),
            observed(null, 'unknown', 'none'),
          ],
        }),
        'en',
      );

      expect(result.metrics[1]).toMatchObject({
        value: '--',
        status: 'insufficient_data',
      });
    });

    it('keeps an observed zero distinct from unknown days', () => {
      const result = service.compute(
        makeFacts({
          waterSeries: [0, 0, 0],
          observedWaterSeries: [
            observed(0, 'observed', 'sufficient'),
            observed(null, 'unknown', 'none'),
            observed(null, 'unknown', 'none'),
          ],
        }),
        'en',
      );

      expect(result.metrics[1]).toMatchObject({
        value: '0.0',
        status: 'needs_attention',
      });
    });

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
