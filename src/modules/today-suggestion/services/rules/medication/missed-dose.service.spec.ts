import { MissedDoseRuleService } from './missed-dose.service';
import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from '../../../types/suggestion.types';
import { buildContext, buildSignal } from '../test-helpers';

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
    expect(candidate!.copyGeneration.templateKey).toBe('missed.dose.pending');
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
    expect(candidate!.copyGeneration.templateKey).toBe('missed.dose.pending');
    expect(candidate!.copyGeneration.params['medicineName']).toBe('Med B');
  });
});
