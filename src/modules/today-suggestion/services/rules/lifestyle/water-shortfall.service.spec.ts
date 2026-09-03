import { WaterShortfallRuleService } from './water-shortfall.service.js';
import {
  SuggestionType,
  SuggestionConfidence,
} from '../../../types/suggestion.types.js';
import { buildContext, buildSignal } from '../test-helpers.js';

describe('WaterShortfallRuleService', () => {
  let rule: WaterShortfallRuleService;

  beforeEach(() => {
    rule = new WaterShortfallRuleService();
  });

  it('should be configured correctly', () => {
    expect(rule.ruleId).toBe('water_behind_target');
    expect(rule.type).toBe(SuggestionType.BEHAVIOR_ADVICE);
    expect(rule.isBaselineRequired).toBe(true);
  });

  it('should not match in the morning', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'water_count',
        payload: { completedCount: 1, targetCount: 8, remainingCount: 7 },
      }),
      buildSignal({
        source: 'record',
        kind: 'water_trend',
        payload: { consecutiveDays: 3, dailyCounts: [] },
      }),
    ];

    const candidate = rule.match(
      signals,
      buildContext({ timeOfDay: 'morning' }),
    );
    expect(candidate).toBeNull();
  });

  it('should match when water is below 50% in the afternoon with baseline', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'water_count',
        payload: {
          completedCount: 2,
          targetCount: 8,
          remainingCount: 6,
          targetMl: 2000,
          targetSource: 'derived_from_legacy_count',
          observedMetric: {
            value: 500,
            state: 'observed',
            coverage: 'sufficient',
            sources: ['manual'],
            observedCount: 2,
            expectedCount: null,
            windowStart: '2026-07-09T00:00:00.000Z',
            windowEnd: '2026-07-10T00:00:00.000Z',
          },
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'water_trend',
        payload: {
          consecutiveDays: 3,
          dailyCounts: [{ date: '2026-07-07', count: 6 }],
        },
      }),
    ];

    const candidate = rule.match(
      signals,
      buildContext({ timeOfDay: 'afternoon' }),
    );
    expect(candidate).not.toBeNull();
    expect(candidate!.type).toBe(SuggestionType.BEHAVIOR_ADVICE);
    expect(candidate!.confidence).toBe(SuggestionConfidence.MEDIUM);
    expect(candidate!.copyGeneration.params).toEqual({
      observedMl: 500,
      targetMl: 2000,
      completionRate: 25,
      consecutiveDays: 3,
    });
  });

  it('abstains instead of treating legacy record counts as canonical water facts', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'water_count',
        payload: { completedCount: 2, targetCount: 8, remainingCount: 6 },
      }),
      buildSignal({
        source: 'record',
        kind: 'water_trend',
        payload: { consecutiveDays: 3, dailyCounts: [] },
      }),
    ];

    expect(
      rule.match(signals, buildContext({ timeOfDay: 'afternoon' })),
    ).toBeNull();
  });

  it('should not match when water is above 50%', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'water_count',
        payload: { completedCount: 5, targetCount: 8, remainingCount: 3 },
      }),
      buildSignal({
        source: 'record',
        kind: 'water_trend',
        payload: { consecutiveDays: 3, dailyCounts: [] },
      }),
    ];

    const candidate = rule.match(
      signals,
      buildContext({ timeOfDay: 'evening' }),
    );
    expect(candidate).toBeNull();
  });

  it.each([
    ['unknown', 'none'],
    ['observed', 'partial'],
  ] as const)('abstains when water coverage is %s/%s', (state, coverage) => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'water_count',
        payload: {
          completedCount: 1,
          targetCount: 8,
          remainingCount: 7,
          targetMl: 2000,
          targetSource: 'derived_from_legacy_count',
          observedMetric: {
            value: state === 'unknown' ? null : 250,
            state,
            coverage,
            sources: state === 'unknown' ? [] : ['manual'],
            observedCount: state === 'unknown' ? 0 : 1,
            expectedCount: null,
            windowStart: '2026-07-09T00:00:00.000Z',
            windowEnd: '2026-07-10T00:00:00.000Z',
          },
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'water_trend',
        payload: { consecutiveDays: 3, dailyCounts: [] },
      }),
    ];

    expect(
      rule.match(signals, buildContext({ timeOfDay: 'afternoon' })),
    ).toBeNull();
  });

  it('uses canonical milliliters instead of record count', () => {
    const buildWaterSignal = (value: number) =>
      buildSignal({
        source: 'record',
        kind: 'water_count',
        payload: {
          completedCount: 1,
          targetCount: 8,
          remainingCount: 7,
          targetMl: 2000,
          targetSource: 'derived_from_legacy_count',
          observedMetric: {
            value,
            state: 'observed',
            coverage: 'sufficient',
            sources: ['manual'],
            observedCount: 1,
            expectedCount: null,
            windowStart: '2026-07-09T00:00:00.000Z',
            windowEnd: '2026-07-10T00:00:00.000Z',
          },
        },
      });
    const trendSignal = buildSignal({
      source: 'record',
      kind: 'water_trend',
      payload: { consecutiveDays: 3, dailyCounts: [] },
    });

    const candidate = rule.match(
      [buildWaterSignal(250), trendSignal],
      buildContext({ timeOfDay: 'afternoon' }),
    );
    expect(candidate).not.toBeNull();
    expect(candidate!.evidence).toEqual(
      expect.arrayContaining([
        { kind: 'record', label: 'current_ml', value: '250' },
        { kind: 'record', label: 'target_ml', value: '2000' },
      ]),
    );
    expect(
      rule.match(
        [buildWaterSignal(2500), trendSignal],
        buildContext({ timeOfDay: 'afternoon' }),
      ),
    ).toBeNull();
  });

  it('abstains when the canonical value is null', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'water_count',
        payload: {
          completedCount: 1,
          targetCount: 8,
          remainingCount: 7,
          targetMl: 2000,
          targetSource: 'derived_from_legacy_count',
          observedMetric: {
            value: null,
            state: 'observed',
            coverage: 'sufficient',
            sources: ['manual'],
            observedCount: 1,
            expectedCount: null,
            windowStart: '2026-07-09T00:00:00.000Z',
            windowEnd: '2026-07-10T00:00:00.000Z',
          },
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'water_trend',
        payload: { consecutiveDays: 3, dailyCounts: [] },
      }),
    ];

    expect(
      rule.match(signals, buildContext({ timeOfDay: 'afternoon' })),
    ).toBeNull();
  });
});
