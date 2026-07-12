import type { I18nService } from 'nestjs-i18n';
import { ReportsLlmSummaryCopyService } from './copy.service';
import type { ReportsAiSummaryContext } from './context.service';

describe('ReportsLlmSummaryCopyService', () => {
  let service: ReportsLlmSummaryCopyService;
  let i18n: vi.Mocked<I18nService>;

  beforeEach(() => {
    i18n = {
      t: vi.fn((key: string) => key),
    } as unknown as vi.Mocked<I18nService>;

    service = new ReportsLlmSummaryCopyService(i18n);
  });

  const makeContext = (
    overrides: Partial<ReportsAiSummaryContext> = {},
  ): ReportsAiSummaryContext => ({
    range: 'last_7_days',
    startDate: '2026-07-04',
    endDate: '2026-07-10',
    generatedAt: '2026-07-10T08:00:00.000Z',
    score: { value: 80, maxValue: 100, status: 'stable' },
    metrics: [
      {
        kind: 'medication',
        value: '85',
        unit: '%',
        status: 'good',
        delta: '+5',
        direction: 'up',
      },
      {
        kind: 'water',
        value: '1.5',
        unit: 'L',
        status: 'stable',
        delta: '+0.2',
        direction: 'up',
      },
      {
        kind: 'sleep',
        value: '7.0',
        unit: 'h',
        status: 'good',
        delta: '+0.5',
        direction: 'up',
      },
    ],
    series: {
      medication: [80, 85, 90, 75, 60, 95, 100],
      water: [1.5, 2.0, 1.8, 1.2, 2.5, 1.9, 1.7],
      sleep: [7, 6.5, 8, 5.5, 7.5, 6, 7],
      mealEstimate: [0, 0, 0, 0, 0, 0, 0],
    },
    dataQuality: {
      medicationTrackedDays: 7,
      waterTrackedDays: 7,
      sleepTrackedDays: 7,
      mealEstimateTrackedDays: 0,
    },
    mealEstimateBreakdown: {
      confirmedDays: 0,
      estimatedDays: 0,
      partialDays: 0,
      analyzingDays: 0,
      failedDays: 0,
    },
    ...overrides,
  });

  describe('summariesDisabled', () => {
    it('returns scoped translation for summaries_disabled', () => {
      const result = service.summariesDisabled('zh-CN');
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.summaries_disabled',
        {
          lang: 'zh-CN',
        },
      );
      expect(result).toBe('reports-ai-summary.summaries_disabled');
    });
  });

  describe('buildFallback', () => {
    it('builds fallback with default summary when metrics are good', () => {
      const ctx = makeContext();
      const result = service.buildFallback(ctx, 'zh-CN');

      expect(result.summary).toBeDefined();
      expect(result.bullets).toHaveLength(3);
      expect(result.bullets[0]!.kind).toBe('medication');
      expect(result.bullets[1]!.kind).toBe('hydration');
      expect(result.bullets[2]!.kind).toBe('sleep');
      expect(result.actionLabel).toBeDefined();
      expect(result.action).toBeDefined();
      expect(result.confidenceNote).toBeDefined();
    });

    it('uses needs_attention summary when medication status is needs_attention', () => {
      const ctx = makeContext({
        metrics: [
          {
            kind: 'medication',
            value: '40',
            unit: '%',
            status: 'needs_attention',
            delta: '-20',
            direction: 'down',
          },
          {
            kind: 'water',
            value: '1.5',
            unit: 'L',
            status: 'stable',
            delta: '+0.2',
            direction: 'up',
          },
          {
            kind: 'sleep',
            value: '7.0',
            unit: 'h',
            status: 'good',
            delta: '+0.5',
            direction: 'up',
          },
        ],
      });

      service.buildFallback(ctx, 'en');
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.summary_needs_attention',
        expect.objectContaining({ lang: 'en' }),
      );
    });

    it('uses needs_attention summary when water status is needs_attention', () => {
      const ctx = makeContext({
        metrics: [
          {
            kind: 'medication',
            value: '85',
            unit: '%',
            status: 'good',
            delta: '+5',
            direction: 'up',
          },
          {
            kind: 'water',
            value: '0.5',
            unit: 'L',
            status: 'needs_attention',
            delta: '-1.0',
            direction: 'down',
          },
          {
            kind: 'sleep',
            value: '7.0',
            unit: 'h',
            status: 'good',
            delta: '+0.5',
            direction: 'up',
          },
        ],
      });

      service.buildFallback(ctx, 'en');
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.summary_needs_attention',
        expect.objectContaining({ lang: 'en' }),
      );
    });

    it('uses stable summary when medication status is good', () => {
      const ctx = makeContext({
        metrics: [
          {
            kind: 'medication',
            value: '90',
            unit: '%',
            status: 'good',
            delta: '+5',
            direction: 'up',
          },
          {
            kind: 'water',
            value: '2.0',
            unit: 'L',
            status: 'good',
            delta: '+0.2',
            direction: 'up',
          },
          {
            kind: 'sleep',
            value: '7.0',
            unit: 'h',
            status: 'good',
            delta: '+0.5',
            direction: 'up',
          },
        ],
      });

      service.buildFallback(ctx, 'en');
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.summary_stable',
        expect.objectContaining({ lang: 'en' }),
      );
    });

    it('uses tracked bullet when medicationTrackedDays > 0', () => {
      const ctx = makeContext({
        dataQuality: {
          medicationTrackedDays: 5,
          waterTrackedDays: 3,
          sleepTrackedDays: 4,
          mealEstimateTrackedDays: 0,
        },
      });

      service.buildFallback(ctx, 'en');
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.bullet_medication_tracked',
        expect.objectContaining({ lang: 'en' }),
      );
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.bullet_hydration_tracked',
        expect.objectContaining({ lang: 'en' }),
      );
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.bullet_sleep_tracked',
        expect.objectContaining({ lang: 'en' }),
      );
    });

    it('uses missing bullet when tracked days are 0', () => {
      const ctx = makeContext({
        dataQuality: {
          medicationTrackedDays: 0,
          waterTrackedDays: 0,
          sleepTrackedDays: 0,
          mealEstimateTrackedDays: 0,
        },
      });

      service.buildFallback(ctx, 'en');
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.bullet_medication_missing',
        expect.objectContaining({ lang: 'en' }),
      );
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.bullet_hydration_missing',
        expect.objectContaining({ lang: 'en' }),
      );
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.bullet_sleep_missing',
        expect.objectContaining({ lang: 'en' }),
      );
    });

    it('uses dayCount=30 for last_30_days range', () => {
      const ctx = makeContext({ range: 'last_30_days' });
      service.buildFallback(ctx, 'zh-CN');
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.confidence_note',
        expect.objectContaining({
          args: expect.objectContaining({ dayCount: 30 }),
        }),
      );
    });

    it('uses dayCount=7 for last_7_days range', () => {
      const ctx = makeContext({ range: 'last_7_days' });
      service.buildFallback(ctx, 'zh-CN');
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.confidence_note',
        expect.objectContaining({
          args: expect.objectContaining({ dayCount: 7 }),
        }),
      );
    });

    it('uses -- for missing medication value', () => {
      const ctx = makeContext({
        metrics: [
          {
            kind: 'medication',
            value: '--',
            unit: '%',
            status: 'insufficient_data',
            delta: '--',
            direction: 'flat',
          },
          {
            kind: 'water',
            value: '1.5',
            unit: 'L',
            status: 'stable',
            delta: '+0.2',
            direction: 'up',
          },
          {
            kind: 'sleep',
            value: '7.0',
            unit: 'h',
            status: 'good',
            delta: '+0.5',
            direction: 'up',
          },
        ],
        dataQuality: {
          medicationTrackedDays: 0,
          waterTrackedDays: 7,
          sleepTrackedDays: 7,
          mealEstimateTrackedDays: 0,
        },
      });

      service.buildFallback(ctx, 'en');
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.bullet_medication_missing',
        expect.objectContaining({
          args: expect.objectContaining({ medicationValue: '--' }),
        }),
      );
    });
  });
});
