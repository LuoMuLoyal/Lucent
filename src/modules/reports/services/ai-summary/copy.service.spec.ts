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
    coverage: {
      medication: { trackedDays: 7, totalDays: 7 },
      water: { trackedDays: 7, totalDays: 7 },
      sleep: { trackedDays: 7, totalDays: 7 },
    },
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
        { lang: 'zh-CN' },
      );
      expect(result).toBe('reports-ai-summary.summaries_disabled');
    });
  });

  describe('buildFallback', () => {
    it('builds fallback with coverage, pattern, and action when data is sufficient', () => {
      const ctx = makeContext();
      const result = service.buildFallback(ctx, 'zh-CN');

      expect(result.summary).toBeDefined();
      expect(result.coverage).toEqual(ctx.coverage);
      expect(result.observedPattern).not.toBeNull();
      expect(result.lowRiskAction).not.toBeNull();
      expect(result.disclaimer).toBeDefined();
    });

    it('abstains when all three dimensions have zero tracked days', () => {
      const ctx = makeContext({
        coverage: {
          medication: { trackedDays: 0, totalDays: 7 },
          water: { trackedDays: 0, totalDays: 7 },
          sleep: { trackedDays: 0, totalDays: 7 },
        },
      });

      const result = service.buildFallback(ctx, 'zh-CN');

      expect(result.summary).toContain('abstain');
      expect(result.observedPattern).toBeNull();
      expect(result.lowRiskAction).toBeNull();
      expect(result.disclaimer).toBeDefined();
    });

    it('builds medication pattern when medication status is good', () => {
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

      const result = service.buildFallback(ctx, 'en');
      expect(result.observedPattern?.kind).toBe('medication');
      expect(result.observedPattern?.source).toBe('reminder_plan');
    });

    it('builds medication pattern when medication status is needs_attention', () => {
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

      const result = service.buildFallback(ctx, 'en');
      expect(result.observedPattern?.kind).toBe('medication');
    });

    it('falls back to hydration pattern when medication is insufficient', () => {
      const ctx = makeContext({
        coverage: {
          medication: { trackedDays: 0, totalDays: 7 },
          water: { trackedDays: 5, totalDays: 7 },
          sleep: { trackedDays: 0, totalDays: 7 },
        },
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
            value: '--',
            unit: 'h',
            status: 'insufficient_data',
            delta: '--',
            direction: 'flat',
          },
        ],
      });

      const result = service.buildFallback(ctx, 'en');
      expect(result.observedPattern?.kind).toBe('hydration');
      expect(result.observedPattern?.source).toBe('daily_record');
    });

    it('uses needs_attention summary when medication or water needs attention', () => {
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

    it('uses dayCount from coverage totalDays for disclaimer', () => {
      const ctx = makeContext({
        coverage: {
          medication: { trackedDays: 5, totalDays: 30 },
          water: { trackedDays: 3, totalDays: 30 },
          sleep: { trackedDays: 0, totalDays: 30 },
        },
      });
      service.buildFallback(ctx, 'zh-CN');
      expect(i18n.t).toHaveBeenCalledWith(
        'reports-ai-summary.fallback.disclaimer',
        expect.objectContaining({
          args: expect.objectContaining({ dayCount: 30 }),
        }),
      );
    });
  });
});
