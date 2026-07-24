import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { SuggestionRule, RuleContext } from '../../types/rule.types';

import type { SuggestionSignal } from '../../types/signal.types';

import type { SuggestionCandidate } from '../../types/candidate.types';
import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from '../../types/suggestion.types';
import {
  MISSED_DOSE_GRACE_MINUTES,
  MISSED_DOSE_BASE_SCORE,
  MISSED_DOSE_OVERDUE_DIVISOR,
} from '../../constants/thresholds.constants';

/**
 * Rule: missed_dose_pending
 * Type: COMPLIANCE
 * Trigger: EVENT (immediate)
 *
 * Fires when a medicine reminder is past its grace period
 * and no dose log (taken/skipped) exists for it.
 */
@Injectable()
export class MissedDoseRuleService implements SuggestionRule {
  readonly ruleId = 'missed_dose_pending';
  readonly ruleVersion = '1.0.0';
  readonly type = SuggestionType.COMPLIANCE;
  readonly triggerType = TriggerType.EVENT;
  readonly isBaselineRequired = false;
  readonly consumableSignalKinds = ['pending_dose'];

  match(
    signals: SuggestionSignal[],
    _context: RuleContext,
  ): SuggestionCandidate | null {
    const pendingSignals = signals.filter(
      (s) => s.kind === 'pending_dose' && s.source === 'medication',
    );

    if (pendingSignals.length === 0) {
      return null;
    }

    // Pick the most overdue dose
    const sorted = pendingSignals
      .filter((s) => {
        const overdue = s.payload['overdueMinutes'] as number;
        return (
          typeof overdue === 'number' && overdue > MISSED_DOSE_GRACE_MINUTES
        );
      })
      .sort((a, b) => {
        const aOverdue = a.payload['overdueMinutes'] as number;
        const bOverdue = b.payload['overdueMinutes'] as number;
        return bOverdue - aOverdue;
      });

    if (sorted.length === 0) {
      return null;
    }

    const signal = sorted[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const medicineName = signal.payload['medicineName'] as string;
    const scheduledHour = signal.payload['scheduledHour'] as number;
    const scheduledMinute = signal.payload['scheduledMinute'] as number;
    const overdueMinutes = signal.payload['overdueMinutes'] as number;

    const timeLabel = `${String(scheduledHour).padStart(2, '0')}:${String(scheduledMinute).padStart(2, '0')}`;
    const hoursOverdue = Math.floor(overdueMinutes / 60);
    const minsRemainder = overdueMinutes % 60;

    return {
      candidateId: randomUUID(),
      ruleId: this.ruleId,
      ruleVersion: this.ruleVersion,
      type: this.type,
      triggerType: this.triggerType,
      evidence: [
        {
          kind: 'reminder',
          label: 'scheduled_time',
          value: timeLabel,
          medicineId: signal.payload['medicineId'] as string,
        },
        {
          kind: 'record',
          label: 'today_status',
          value: 'unconfirmed',
        },
      ],
      primaryAction: {
        actionId: 'go_confirm',
        label: 'go_confirm',
        route: '/medicine',
        authRequired: true,
      },
      secondaryActions: [
        {
          actionId: 'skip_dose',
          label: 'skip_dose',
          route: '/medicine?action=skip',
          authRequired: true,
        },
      ],
      priorityScore:
        MISSED_DOSE_BASE_SCORE +
        Math.floor(overdueMinutes / MISSED_DOSE_OVERDUE_DIVISOR),
      confidence: SuggestionConfidence.HIGH,
      notificationEligible: true,
      copyGeneration: {
        templateKey: 'missed.dose.pending',
        params: {
          medicineName,
          timeLabel,
          hoursOverdue,
          minsRemainder,
          overdueMinutes,
        },
      },
    };
  }
}
