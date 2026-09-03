import { SleepShortfallRuleService } from './sleep-shortfall.service.js';
import { buildContext, buildSignal } from '../test-helpers.js';

describe('SleepShortfallRuleService', () => {
  let rule: SleepShortfallRuleService;

  beforeEach(() => {
    rule = new SleepShortfallRuleService();
  });

  it('should match when sleep duration is below 6 hours with baseline', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'sleep_record',
        payload: { durationMinutes: 300, quality: 'poor', recordId: 'rec-1' },
      }),
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: { consecutiveDays: 3, dailyDurations: [] },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).not.toBeNull();
    expect(candidate!.subtype).toBe('sleep');
  });

  it('should not match when sleep duration is above 6 hours', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'sleep_record',
        payload: { durationMinutes: 420, quality: 'good' },
      }),
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: { consecutiveDays: 3, dailyDurations: [] },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });
});
