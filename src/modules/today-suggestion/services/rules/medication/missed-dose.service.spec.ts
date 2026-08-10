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
    expect(rule.consumableSignalKinds).toEqual(['overdueUnconfirmed']);
  });

  it('should match an overdue unconfirmed dose', () => {
    const signals = [
      buildSignal({
        kind: 'overdueUnconfirmed',
        payload: {
          medicineId: 'med-1',
          medicineName: 'Test Medicine',
          scheduledHour: 8,
          scheduledMinute: 0,
          overdueMinutes: 60,
          status: 'overdueUnconfirmed',
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).not.toBeNull();
    expect(candidate!.type).toBe(SuggestionType.COMPLIANCE);
    expect(candidate!.confidence).toBe(SuggestionConfidence.HIGH);
    expect(candidate!.notificationEligible).toBe(true);
    expect(candidate!.copyGeneration.templateKey).toBe('missed.dose.pending');
    expect(candidate!.copyGeneration.params['confirmationStatus']).toBe(
      'unconfirmed',
    );
  });

  it('should not match pending_dose even when its status is overdueUnconfirmed', () => {
    const signals = [
      buildSignal({
        kind: 'pending_dose',
        payload: {
          medicineId: 'med-1',
          medicineName: 'Test Medicine',
          scheduledHour: 8,
          scheduledMinute: 0,
          overdueMinutes: 60,
          status: 'overdueUnconfirmed',
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });

  it('should not match when no pending dose signals exist', () => {
    const candidate = rule.match([], buildContext());
    expect(candidate).toBeNull();
  });

  it('should not match when overdue is within grace period', () => {
    const signals = [
      buildSignal({
        kind: 'overdueUnconfirmed',
        payload: {
          medicineId: 'med-1',
          medicineName: 'Test Medicine',
          scheduledHour: 8,
          scheduledMinute: 0,
          overdueMinutes: 15,
          status: 'overdueUnconfirmed',
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'should reject non-finite overdueMinutes (%s)',
    (overdueMinutes) => {
      const signals = [
        buildSignal({
          kind: 'overdueUnconfirmed',
          payload: {
            medicineId: 'med-1',
            medicineName: 'Test Medicine',
            scheduledHour: 8,
            scheduledMinute: 0,
            overdueMinutes,
          },
        }),
      ];

      const candidate = rule.match(signals, buildContext());
      expect(candidate).toBeNull();
    },
  );

  it.each([
    ['medicineName', 'medicineName'],
    ['scheduledHour', 'scheduledHour'],
    ['scheduledMinute', 'scheduledMinute'],
  ] as const)('should reject a signal missing %s', (_label, field) => {
    const payloadByMissingField = {
      medicineName: {
        medicineId: 'med-1',
        scheduledHour: 8,
        scheduledMinute: 0,
        overdueMinutes: 60,
      },
      scheduledHour: {
        medicineId: 'med-1',
        medicineName: 'Test Medicine',
        scheduledMinute: 0,
        overdueMinutes: 60,
      },
      scheduledMinute: {
        medicineId: 'med-1',
        medicineName: 'Test Medicine',
        scheduledHour: 8,
        overdueMinutes: 60,
      },
    };

    const candidate = rule.match(
      [
        buildSignal({
          kind: 'overdueUnconfirmed',
          payload: payloadByMissingField[field],
        }),
      ],
      buildContext(),
    );
    expect(candidate).toBeNull();
  });

  it.each([
    ['scheduledHour', Number.NaN],
    ['scheduledHour', Number.POSITIVE_INFINITY],
    ['scheduledHour', -1],
    ['scheduledHour', 24],
    ['scheduledMinute', Number.NaN],
    ['scheduledMinute', Number.POSITIVE_INFINITY],
    ['scheduledMinute', -1],
    ['scheduledMinute', 60],
  ] as const)('should reject an invalid %s value', (field, value) => {
    const candidate = rule.match(
      [
        buildSignal({
          kind: 'overdueUnconfirmed',
          payload: {
            medicineId: 'med-1',
            medicineName: 'Test Medicine',
            scheduledHour: field === 'scheduledHour' ? value : 8,
            scheduledMinute: field === 'scheduledMinute' ? value : 0,
            overdueMinutes: 60,
          },
        }),
      ],
      buildContext(),
    );
    expect(candidate).toBeNull();
  });

  it('should pick the most overdue dose when multiple exist', () => {
    const signals = [
      buildSignal({
        signalId: 'sig-1',
        kind: 'overdueUnconfirmed',
        payload: {
          medicineId: 'med-1',
          medicineName: 'Med A',
          scheduledHour: 8,
          scheduledMinute: 0,
          overdueMinutes: 60,
          status: 'overdueUnconfirmed',
        },
      }),
      buildSignal({
        signalId: 'sig-2',
        kind: 'overdueUnconfirmed',
        payload: {
          medicineId: 'med-2',
          medicineName: 'Med B',
          scheduledHour: 12,
          scheduledMinute: 0,
          overdueMinutes: 180,
          status: 'overdueUnconfirmed',
        },
      }),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).not.toBeNull();
    expect(candidate!.copyGeneration.templateKey).toBe('missed.dose.pending');
    expect(candidate!.copyGeneration.params['medicineName']).toBe('Med B');
  });
});
