import { WaterShortfallRuleService } from './water-shortfall.service';
import {
  SuggestionType,
  SuggestionConfidence,
} from '../../types/suggestion.types';
import { buildContext, buildSignal } from './test-helpers';

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
        payload: { completedCount: 2, targetCount: 8, remainingCount: 6 },
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
});
