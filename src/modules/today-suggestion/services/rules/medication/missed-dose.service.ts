import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { SuggestionRule, RuleContext } from '../../../types/rule.types.js';

import type { SuggestionSignal } from '../../../types/signal.types.js';

import type { SuggestionCandidate } from '../../../types/candidate.types.js';
import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from '../../../types/suggestion.types.js';
import {
  MISSED_DOSE_GRACE_MINUTES,
  MISSED_DOSE_BASE_SCORE,
  MISSED_DOSE_OVERDUE_DIVISOR,
} from '../../../constants/thresholds.constants.js';

/**
 * Rule: missed_dose_pending
 * Type: COMPLIANCE
 * Trigger: EVENT (immediate)
 *
 * Fires when a medicine reminder is past its grace period and remains
 * unconfirmed. It does not infer a missed dose from a generic pending signal.
 */
@Injectable()
export class MissedDoseRuleService implements SuggestionRule {
  readonly ruleId = 'missed_dose_pending';
  readonly ruleVersion = '1.0.0';
  readonly type = SuggestionType.COMPLIANCE;
  readonly triggerType = TriggerType.EVENT;
  readonly isBaselineRequired = false;
  readonly consumableSignalKinds = ['overdueUnconfirmed'];

  /**
   * Matches the most overdue unconfirmed medication dose.
   *
   * Signal payloads for the generated `skip_dose` route are passed through to
   * {@link buildSkipRoute}. `scheduledFor` (ISO date string) and `scheduledTime`
   * (time label string) are expected to be strings when present; the route
   * builder omits them with a warning if that assumption is violated.
   */
  match(
    signals: SuggestionSignal[],
    _context: RuleContext,
  ): SuggestionCandidate | null {
    const overdueSignals = signals.filter(
      (s) => s.kind === 'overdueUnconfirmed' && s.source === 'medication',
    );

    if (overdueSignals.length === 0) {
      return null;
    }

    // Pick the most overdue unconfirmed dose.
    const sorted = overdueSignals
      .filter((s) => {
        const overdue = s.payload['overdueMinutes'] as number;
        const medicineName = s.payload['medicineName'];
        const scheduledHour = s.payload['scheduledHour'] as number;
        const scheduledMinute = s.payload['scheduledMinute'] as number;
        return (
          typeof overdue === 'number' &&
          Number.isFinite(overdue) &&
          overdue > MISSED_DOSE_GRACE_MINUTES &&
          typeof medicineName === 'string' &&
          Number.isInteger(scheduledHour) &&
          scheduledHour >= 0 &&
          scheduledHour <= 23 &&
          Number.isInteger(scheduledMinute) &&
          scheduledMinute >= 0 &&
          scheduledMinute <= 59
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
          route: buildSkipRoute(signal),
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
          confirmationStatus: 'unconfirmed',
        },
      },
    };
  }
}

const logger = new Logger(MissedDoseRuleService.name);

function buildSkipRoute(signal: SuggestionSignal): string {
  const params = new URLSearchParams();
  params.set('action', 'skip');

  appendStringParam(params, 'currentMedicineId', signal.payload['medicineId']);
  appendStringParam(params, 'reminderId', signal.payload['reminderId']);
  appendStringParam(params, 'scheduledFor', signal.payload['scheduledFor']);
  appendStringParam(params, 'scheduledTime', signal.payload['scheduledTime']);

  return `/medicine?${params.toString()}`;
}

function appendStringParam(
  params: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (typeof value === 'string' && value.length > 0) {
    params.set(key, value);
    return;
  }

  if (value !== undefined && value !== null) {
    logger.warn(
      `Omitting "${key}" from skip_dose route: expected a non-empty string, received ${typeof value}`,
    );
  }
}
