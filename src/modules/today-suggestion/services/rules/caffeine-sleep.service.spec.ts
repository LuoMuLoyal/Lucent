import { CaffeineSleepRuleService } from './caffeine-sleep.service';
import {
  SuggestionType,
  SuggestionConfidence,
} from '../../types/suggestion.types';
import { buildContext, buildSignal } from './test-helpers';

describe('CaffeineSleepRuleService', () => {
  let rule: CaffeineSleepRuleService;

  beforeEach(() => {
    rule = new CaffeineSleepRuleService();
  });

  it('should be configured correctly', () => {
    expect(rule.ruleId).toBe('caffeine_sleep_correlation');
    expect(rule.type).toBe(SuggestionType.BEHAVIOR_ADVICE);
    expect(rule.isBaselineRequired).toBe(true);
    expect(rule.consumableSignalKinds).toEqual([
      'caffeine_trend',
      'sleep_trend',
    ]);
  });

  it('should match when caffeine intake correlates with sleep decline', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'caffeine_trend',
        payload: {
          dailyIntakes: [
            { date: '2026-07-07', count: 2 },
            { date: '2026-07-08', count: 3 },
            { date: '2026-07-09', count: 2 },
          ],
          consecutiveDays: 3,
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: {
          dailyDurations: [
            { date: '2026-07-07', durationMinutes: 420 },
            { date: '2026-07-08', durationMinutes: 380 },
            { date: '2026-07-09', durationMinutes: 320 },
          ],
          consecutiveDays: 3,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).not.toBeNull();
    expect(candidate!.type).toBe(SuggestionType.BEHAVIOR_ADVICE);
    expect(candidate!.subtype).toBe('caffeine');
    expect(candidate!.confidence).toBe(SuggestionConfidence.MEDIUM);
    expect(candidate!.copyGeneration.templateKey).toBe(
      'caffeine.sleep.correlation',
    );
  });

  it('should not match when caffeine signal is missing', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: {
          dailyDurations: [
            { date: '2026-07-08', durationMinutes: 380 },
            { date: '2026-07-09', durationMinutes: 320 },
          ],
          consecutiveDays: 2,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });

  it('should not match when sleep trend signal is missing', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'caffeine_trend',
        payload: {
          dailyIntakes: [{ date: '2026-07-09', count: 2 }],
          consecutiveDays: 1,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });

  it('should not match when caffeine days is below minimum', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'caffeine_trend',
        payload: {
          dailyIntakes: [{ date: '2026-07-09', count: 1 }],
          consecutiveDays: 1,
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: {
          dailyDurations: [
            { date: '2026-07-08', durationMinutes: 380 },
            { date: '2026-07-09', durationMinutes: 320 },
          ],
          consecutiveDays: 2,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });

  it('should not match when sleep is not declining', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'caffeine_trend',
        payload: {
          dailyIntakes: [
            { date: '2026-07-07', count: 2 },
            { date: '2026-07-08', count: 2 },
            { date: '2026-07-09', count: 2 },
          ],
          consecutiveDays: 3,
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: {
          dailyDurations: [
            { date: '2026-07-07', durationMinutes: 350 },
            { date: '2026-07-08', durationMinutes: 380 },
            { date: '2026-07-09', durationMinutes: 400 },
          ],
          consecutiveDays: 3,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });

  it('should not match when latest sleep is above 6 hours', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'caffeine_trend',
        payload: {
          dailyIntakes: [
            { date: '2026-07-07', count: 2 },
            { date: '2026-07-08', count: 2 },
          ],
          consecutiveDays: 2,
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: {
          dailyDurations: [
            { date: '2026-07-07', durationMinutes: 500 },
            { date: '2026-07-08', durationMinutes: 420 },
          ],
          consecutiveDays: 2,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });

  it('should not match when caffeine and sleep dates do not overlap', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'caffeine_trend',
        payload: {
          dailyIntakes: [
            { date: '2026-07-01', count: 2 },
            { date: '2026-07-02', count: 2 },
          ],
          consecutiveDays: 2,
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: {
          dailyDurations: [
            { date: '2026-07-08', durationMinutes: 420 },
            { date: '2026-07-09', durationMinutes: 320 },
          ],
          consecutiveDays: 2,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });
});
