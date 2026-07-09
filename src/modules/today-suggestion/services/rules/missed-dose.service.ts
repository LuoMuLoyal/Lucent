import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  SuggestionRule,
  SuggestionSignal,
  RuleContext,
  SuggestionCandidate,
} from '../../types';
import { SuggestionType, TriggerType, SuggestionConfidence } from '../../types';
import {
  MISSED_DOSE_GRACE_MINUTES,
  MISSED_DOSE_BASE_SCORE,
  MISSED_DOSE_OVERDUE_DIVISOR,
} from '../../constants';

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
      title: `${timeLabel} 的 ${medicineName} 尚未确认`,
      reason: `计划服药时间为 ${timeLabel}，当前已超时 ${String(hoursOverdue)} 小时 ${String(minsRemainder)} 分钟且未标记服用。`,
      evidence: [
        {
          kind: 'reminder',
          label: '计划时间',
          value: timeLabel,
          medicineId: signal.payload['medicineId'] as string,
        },
        {
          kind: 'record',
          label: '今日状态',
          value: '未确认',
        },
      ],
      boundary: '此提醒基于您的用药计划，不能替代医生或药师建议。',
      primaryAction: {
        actionId: 'go_confirm',
        label: '去确认',
        route: '/medicine',
        authRequired: true,
      },
      secondaryActions: [
        {
          actionId: 'skip_dose',
          label: '跳过此次',
          route: '/medicine?action=skip',
          authRequired: true,
        },
      ],
      priorityScore:
        MISSED_DOSE_BASE_SCORE +
        Math.floor(overdueMinutes / MISSED_DOSE_OVERDUE_DIVISOR),
      confidence: SuggestionConfidence.HIGH,
      notificationEligible: true,
    };
  }
}
