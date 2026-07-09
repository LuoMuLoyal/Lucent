import { MissedDoseRuleService } from './missed-dose.service';
import { WaterShortfallRuleService } from './water-shortfall.service';
import { SleepShortfallRuleService } from './sleep-shortfall.service';
import { DeterioratingTrendRuleService } from './deteriorating-trend.service';
import { CaffeineSleepRuleService } from './caffeine-sleep.service';
import { MoodSleepRuleService } from './mood-sleep.service';
import { CoverageRuleService } from './coverage.service';
import { RegistryService } from './registry.service';
import { RuleVersionRegistry } from './rule-version-registry.service';
import { SuggestionType, TriggerType, SuggestionConfidence } from '../../types';
import type {
  SuggestionSignal,
  RuleContext,
  BaselineDimension,
} from '../../types';

function buildContext(overrides: Partial<RuleContext> = {}): RuleContext {
  const baselineStatus = new Map<BaselineDimension, boolean>();
  return {
    userId: 'test-user',
    date: '2026-07-09',
    timeOfDay: 'afternoon',
    baselineStatus,
    ...overrides,
  };
}

function buildSignal(
  overrides: Partial<SuggestionSignal> = {},
): SuggestionSignal {
  return {
    signalId: 'test-signal',
    source: 'medication',
    kind: 'pending_dose',
    recordedAt: new Date('2026-07-09T00:00:00.000Z'),
    payload: {},
    userId: 'test-user',
    triggerType: TriggerType.EVENT,
    ...overrides,
  };
}

describe('TodaySuggestion Rules', () => {
  describe('MissedDoseRuleService', () => {
    let rule: MissedDoseRuleService;

    beforeEach(() => {
      rule = new MissedDoseRuleService();
    });

    it('should be configured correctly', () => {
      expect(rule.ruleId).toBe('missed_dose_pending');
      expect(rule.type).toBe(SuggestionType.COMPLIANCE);
      expect(rule.triggerType).toBe(TriggerType.EVENT);
      expect(rule.isBaselineRequired).toBe(false);
    });

    it('should match when a dose is overdue past grace period', () => {
      const signals = [
        buildSignal({
          kind: 'pending_dose',
          payload: {
            medicineId: 'med-1',
            medicineName: 'Test Medicine',
            scheduledHour: 8,
            scheduledMinute: 0,
            overdueMinutes: 60,
          },
        }),
      ];

      const candidate = rule.match(signals, buildContext());
      expect(candidate).not.toBeNull();
      expect(candidate!.type).toBe(SuggestionType.COMPLIANCE);
      expect(candidate!.confidence).toBe(SuggestionConfidence.HIGH);
      expect(candidate!.notificationEligible).toBe(true);
      expect(candidate!.title).toContain('Test Medicine');
    });

    it('should not match when no pending dose signals exist', () => {
      const candidate = rule.match([], buildContext());
      expect(candidate).toBeNull();
    });

    it('should not match when overdue is within grace period', () => {
      const signals = [
        buildSignal({
          payload: {
            medicineId: 'med-1',
            medicineName: 'Test Medicine',
            scheduledHour: 8,
            scheduledMinute: 0,
            overdueMinutes: 15,
          },
        }),
      ];

      const candidate = rule.match(signals, buildContext());
      expect(candidate).toBeNull();
    });

    it('should pick the most overdue dose when multiple exist', () => {
      const signals = [
        buildSignal({
          signalId: 'sig-1',
          payload: {
            medicineId: 'med-1',
            medicineName: 'Med A',
            scheduledHour: 8,
            scheduledMinute: 0,
            overdueMinutes: 60,
          },
        }),
        buildSignal({
          signalId: 'sig-2',
          payload: {
            medicineId: 'med-2',
            medicineName: 'Med B',
            scheduledHour: 12,
            scheduledMinute: 0,
            overdueMinutes: 180,
          },
        }),
      ];

      const candidate = rule.match(signals, buildContext());
      expect(candidate).not.toBeNull();
      expect(candidate!.title).toContain('Med B');
    });
  });

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

  describe('DeterioratingTrendRuleService', () => {
    let rule: DeterioratingTrendRuleService;

    beforeEach(() => {
      rule = new DeterioratingTrendRuleService();
    });

    it('should match when symptoms show deteriorating trend', () => {
      const signals = [
        buildSignal({
          source: 'record',
          kind: 'symptom_trend',
          payload: {
            byDate: [
              { date: '2026-07-07', title: '头痛', value: '2/5', note: null },
              { date: '2026-07-08', title: '头痛', value: '3/5', note: null },
              { date: '2026-07-09', title: '头痛', value: '4/5', note: null },
            ],
            totalRecords: 3,
            uniqueDates: 3,
          },
        }),
      ];

      const candidate = rule.match(signals, buildContext());
      expect(candidate).not.toBeNull();
      expect(candidate!.type).toBe(SuggestionType.TREND);
      expect(candidate!.title).toContain('头痛');
    });

    it('should not match when symptoms are improving', () => {
      const signals = [
        buildSignal({
          source: 'record',
          kind: 'symptom_trend',
          payload: {
            byDate: [
              { date: '2026-07-07', title: '头痛', value: '4/5', note: null },
              { date: '2026-07-08', title: '头痛', value: '3/5', note: null },
              { date: '2026-07-09', title: '头痛', value: '2/5', note: null },
            ],
            totalRecords: 3,
            uniqueDates: 3,
          },
        }),
      ];

      const candidate = rule.match(signals, buildContext());
      expect(candidate).toBeNull();
    });
  });

  describe('CoverageRuleService', () => {
    let rule: CoverageRuleService;

    beforeEach(() => {
      rule = new CoverageRuleService();
    });

    it('should match when profile is incomplete', () => {
      const signals = [
        buildSignal({
          source: 'profile',
          kind: 'profile_completeness',
          payload: {
            activeAllergyCount: 0,
            activeConditionCount: 0,
            missingFields: ['birthDate', 'sexAtBirth'],
            isComplete: false,
          },
        }),
      ];

      const candidate = rule.match(signals, buildContext());
      expect(candidate).not.toBeNull();
      expect(candidate!.type).toBe(SuggestionType.COVERAGE);
    });

    it('should match when there are zero records today', () => {
      const signals = [
        buildSignal({
          source: 'profile',
          kind: 'profile_completeness',
          payload: {
            activeAllergyCount: 0,
            activeConditionCount: 0,
            missingFields: [],
            isComplete: true,
          },
        }),
        buildSignal({
          source: 'record',
          kind: 'record_density',
          payload: {
            todayCount: 0,
            todayKinds: [],
            multiDayCount: 5,
            lookbackDays: 7,
          },
        }),
      ];

      const candidate = rule.match(signals, buildContext());
      expect(candidate).not.toBeNull();
      expect(candidate!.subtype).toBe('empty_today');
    });

    it('should not match when profile is complete and records exist', () => {
      const signals = [
        buildSignal({
          source: 'profile',
          kind: 'profile_completeness',
          payload: {
            activeAllergyCount: 1,
            activeConditionCount: 1,
            missingFields: [],
            isComplete: true,
          },
        }),
        buildSignal({
          source: 'record',
          kind: 'record_density',
          payload: {
            todayCount: 3,
            todayKinds: ['water', 'meal', 'symptom'],
            multiDayCount: 10,
            lookbackDays: 7,
          },
        }),
      ];

      const candidate = rule.match(signals, buildContext());
      expect(candidate).toBeNull();
    });
  });

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
      expect(candidate!.title).toContain('咖啡因');
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
      expect(candidate!.title).toContain('情绪');
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

  describe('RuleVersionRegistry', () => {
    let registry: RuleVersionRegistry;

    beforeEach(() => {
      registry = new RuleVersionRegistry();
    });

    it('should return the single registered version', () => {
      const rule = new MissedDoseRuleService();
      registry.registerVersion(rule);

      const selected = registry.selectVersion('missed_dose_pending', 'user-1');
      expect(selected).toBe(rule);
    });

    it('should return null for unregistered rule', () => {
      expect(registry.selectVersion('nonexistent', 'user-1')).toBeNull();
    });

    it('should always select the same version for the same user+rule', () => {
      const rule1 = new MissedDoseRuleService();
      // Create a second version with same ruleId but different version
      const rule2 = Object.assign(
        Object.create(MissedDoseRuleService.prototype),
        rule1,
        { ruleVersion: '2.0.0' },
      );
      registry.registerVersion(rule1);
      registry.registerVersion(rule2);
      registry.setDistribution('missed_dose_pending', 0.5);

      const first = registry.selectVersion('missed_dose_pending', 'user-1');
      const second = registry.selectVersion('missed_dose_pending', 'user-1');
      expect(first).toBe(second);
    });

    it('should return old version when distribution is 0', () => {
      const rule1 = new MissedDoseRuleService();
      const rule2 = Object.assign(
        Object.create(MissedDoseRuleService.prototype),
        rule1,
        { ruleVersion: '2.0.0' },
      );
      registry.registerVersion(rule1);
      registry.registerVersion(rule2);
      registry.setDistribution('missed_dose_pending', 0);

      const selected = registry.selectVersion('missed_dose_pending', 'user-1');
      expect(selected).toBe(rule1);
    });

    it('should return new version when distribution is 1', () => {
      const rule1 = new MissedDoseRuleService();
      const rule2 = Object.assign(
        Object.create(MissedDoseRuleService.prototype),
        rule1,
        { ruleVersion: '2.0.0' },
      );
      registry.registerVersion(rule1);
      registry.registerVersion(rule2);
      registry.setDistribution('missed_dose_pending', 1);

      const selected = registry.selectVersion('missed_dose_pending', 'user-1');
      expect(selected).toBe(rule2);
    });

    it('should respect forced version over distribution', () => {
      const rule1 = new MissedDoseRuleService();
      const rule2 = Object.assign(
        Object.create(MissedDoseRuleService.prototype),
        rule1,
        { ruleVersion: '2.0.0' },
      );
      registry.registerVersion(rule1);
      registry.registerVersion(rule2);
      registry.setDistribution('missed_dose_pending', 0);
      registry.forceVersion('missed_dose_pending', '2.0.0');

      const selected = registry.selectVersion('missed_dose_pending', 'user-1');
      expect(selected).toBe(rule2);
    });

    it('should clear forced version when null is passed', () => {
      const rule1 = new MissedDoseRuleService();
      const rule2 = Object.assign(
        Object.create(MissedDoseRuleService.prototype),
        rule1,
        { ruleVersion: '2.0.0' },
      );
      registry.registerVersion(rule1);
      registry.registerVersion(rule2);
      registry.forceVersion('missed_dose_pending', '2.0.0');
      registry.forceVersion('missed_dose_pending', null);
      registry.setDistribution('missed_dose_pending', 0);

      const selected = registry.selectVersion('missed_dose_pending', 'user-1');
      expect(selected).toBe(rule1);
    });

    it('should report multi-version rule IDs', () => {
      const rule1 = new MissedDoseRuleService();
      const rule2 = Object.assign(
        Object.create(MissedDoseRuleService.prototype),
        rule1,
        { ruleVersion: '2.0.0' },
      );
      registry.registerVersion(rule1);
      registry.registerVersion(rule2);

      expect(registry.getMultiVersionRuleIds()).toEqual([
        'missed_dose_pending',
      ]);
    });
  });

  describe('RegistryService', () => {
    it('should register and retrieve rules', () => {
      const registry = new RegistryService();
      const rule = new MissedDoseRuleService();

      registry.register(rule);

      expect(registry.getAll()).toHaveLength(1);
      expect(registry.getById('missed_dose_pending')).toBe(rule);
    });

    it('should throw on duplicate registration', () => {
      const registry = new RegistryService();
      const rule = new MissedDoseRuleService();

      registry.register(rule);
      expect(() => {
        registry.register(rule);
      }).toThrow('Duplicate');
    });
  });
});
