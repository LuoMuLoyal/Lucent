import { MoodSleepRuleService } from './mood-sleep.service';
import { SuggestionType } from '../../../types/suggestion.types';
import { buildContext, buildSignal } from '../test-helpers';

describe('MoodSleepRuleService', () => {
  let rule: MoodSleepRuleService;

  beforeEach(() => {
    rule = new MoodSleepRuleService();
  });

  it('should be configured correctly', () => {
    expect(rule.ruleId).toBe('mood_sleep_correlation');
    expect(rule.type).toBe(SuggestionType.BEHAVIOR_ADVICE);
    expect(rule.consumableSignalKinds).toEqual(['mood_trend', 'sleep_trend']);
  });

  it('should match when low mood correlates with insufficient sleep', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'mood_trend',
        payload: {
          dailyMoods: [
            { date: '2026-07-07', moodScore: 4, label: 'good' },
            { date: '2026-07-08', moodScore: 3, label: 'ok' },
            { date: '2026-07-09', moodScore: 2, label: 'bad' },
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
            { date: '2026-07-09', durationMinutes: 300 },
          ],
          consecutiveDays: 3,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).not.toBeNull();
    expect(candidate!.subtype).toBe('mood');
    expect(candidate!.copyGeneration.templateKey).toBe(
      'mood.sleep.correlation',
    );
  });

  it('should not match when mood is not low', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'mood_trend',
        payload: {
          dailyMoods: [
            { date: '2026-07-08', moodScore: 4, label: 'good' },
            { date: '2026-07-09', moodScore: 4, label: 'good' },
          ],
          consecutiveDays: 2,
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: {
          dailyDurations: [
            { date: '2026-07-08', durationMinutes: 380 },
            { date: '2026-07-09', durationMinutes: 300 },
          ],
          consecutiveDays: 2,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });

  it('should not match when sleep is above 6 hours', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'mood_trend',
        payload: {
          dailyMoods: [
            { date: '2026-07-08', moodScore: 2, label: 'bad' },
            { date: '2026-07-09', moodScore: 2, label: 'bad' },
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
            { date: '2026-07-09', durationMinutes: 400 },
          ],
          consecutiveDays: 2,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });

  it('should not match when mood signal is missing', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: {
          dailyDurations: [
            { date: '2026-07-08', durationMinutes: 300 },
            { date: '2026-07-09', durationMinutes: 300 },
          ],
          consecutiveDays: 2,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });

  it('should not match when mood days is below minimum', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'mood_trend',
        payload: {
          dailyMoods: [{ date: '2026-07-09', moodScore: 2, label: 'bad' }],
          consecutiveDays: 1,
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: {
          dailyDurations: [
            { date: '2026-07-08', durationMinutes: 300 },
            { date: '2026-07-09', durationMinutes: 300 },
          ],
          consecutiveDays: 2,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });

  it('should not match when dates do not overlap', () => {
    const signals = [
      buildSignal({
        source: 'record',
        kind: 'mood_trend',
        payload: {
          dailyMoods: [
            { date: '2026-07-01', moodScore: 2, label: 'bad' },
            { date: '2026-07-02', moodScore: 2, label: 'bad' },
          ],
          consecutiveDays: 2,
        },
      }),
      buildSignal({
        source: 'record',
        kind: 'sleep_trend',
        payload: {
          dailyDurations: [
            { date: '2026-07-08', durationMinutes: 300 },
            { date: '2026-07-09', durationMinutes: 300 },
          ],
          consecutiveDays: 2,
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });
});
