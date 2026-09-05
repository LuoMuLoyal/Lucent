import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SuggestionRule, RuleContext } from '../../../types/rule.types.js';

import type { SuggestionSignal } from '../../../types/signal.types.js';

import type { SuggestionCandidate } from '../../../types/candidate.types.js';
import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from '../../../types/suggestion.types.js';

interface EventCheckIn {
  date: string;
  outcome: string;
}

interface EventCheckInTrendPayload {
  eventId: string;
  eventTitle: string;
  startedAt: string;
  endedAt: string | null;
  checkIns: EventCheckIn[];
  symptomRecordCount: number;
}

const WORSENED_OUTCOME = 'worsened';
const LOOKBACK_DAYS = 3;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rule: event_check_in_trend
 * Type: TREND
 * Trigger: EVENT
 *
 * Fires when the user's active health event shows a worsening trend:
 *   - two consecutive "worsened" check-ins within the last 3 days, or
 *   - any symptom records recorded during the event window.
 *
 * The resulting candidate is high-confidence, high-priority, and eligible for
 * notification escalation via EscalationService.
 */
@Injectable()
export class EventCheckInTrendRuleService implements SuggestionRule {
  readonly ruleId = 'event_check_in_trend';
  readonly ruleVersion = '1.0.0';
  readonly type = SuggestionType.TREND;
  readonly triggerType = TriggerType.EVENT;
  readonly isBaselineRequired = false;
  readonly consumableSignalKinds = ['event_check_in_trend'];

  match(
    signals: SuggestionSignal[],
    context: RuleContext,
  ): SuggestionCandidate | null {
    const signal = signals.find(
      (s) => s.kind === 'event_check_in_trend' && s.source === 'health_event',
    );

    if (signal == null) {
      return null;
    }

    const payload = signal.payload as unknown as EventCheckInTrendPayload;
    const window = this.buildLookbackWindow(context.date);

    const checkInsInWindow = [...payload.checkIns]
      .filter((checkIn) => window.includes(checkIn.date))
      .sort((a, b) => a.date.localeCompare(b.date));

    const hasConsecutiveWorsened =
      this.hasConsecutiveWorsened(checkInsInWindow);
    const worsenedCount = checkInsInWindow.filter(
      (checkIn) => checkIn.outcome === WORSENED_OUTCOME,
    ).length;
    const hasSymptomRecordsDuringEvent = payload.symptomRecordCount > 0;

    const shouldFire = hasConsecutiveWorsened || hasSymptomRecordsDuringEvent;

    if (!shouldFire) {
      return null;
    }

    const consecutiveWorsenedCheckIns =
      this.maxConsecutiveWorsenedCheckIns(checkInsInWindow);

    return {
      candidateId: randomUUID(),
      ruleId: this.ruleId,
      ruleVersion: this.ruleVersion,
      type: this.type,
      triggerType: this.triggerType,
      evidence: [
        {
          kind: 'trend',
          label: 'worsened_check_ins',
          value: String(worsenedCount),
          args: { windowDays: LOOKBACK_DAYS },
        },
        {
          kind: 'trend',
          label: 'symptom_records_during_event',
          value: String(payload.symptomRecordCount),
        },
      ],
      primaryAction: {
        actionId: 'review_event',
        label: 'review_event',
        route: `/report/review/${encodeURIComponent(payload.eventId)}`,
        authRequired: true,
      },
      priorityScore: 750,
      confidence: SuggestionConfidence.HIGH,
      notificationEligible: true,
      subtype: 'health_event',
      copyGeneration: {
        templateKey: 'health_event.check_in_trend',
        params: {
          consecutiveWorsenedCheckIns,
          worsenedCount,
          symptomRecordCount: payload.symptomRecordCount,
        },
      },
    };
  }

  private buildLookbackWindow(date: string): string[] {
    if (!DATE_ONLY_RE.test(date)) {
      return [];
    }
    const day = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) {
      return [];
    }
    const window: string[] = [];
    for (let offset = 0; offset < LOOKBACK_DAYS; offset++) {
      const current = new Date(day);
      current.setUTCDate(current.getUTCDate() - offset);
      window.push(current.toISOString().slice(0, 10));
    }
    return window;
  }

  private hasConsecutiveWorsened(checkIns: EventCheckIn[]): boolean {
    for (let i = 1; i < checkIns.length; i++) {
      const previous = checkIns[i - 1];
      const current = checkIns[i];
      if (
        previous != null &&
        current != null &&
        previous.outcome === WORSENED_OUTCOME &&
        current.outcome === WORSENED_OUTCOME
      ) {
        return true;
      }
    }
    return false;
  }

  private maxConsecutiveWorsenedCheckIns(checkIns: EventCheckIn[]): number {
    let maxRun = 0;
    let currentRun = 0;
    for (const checkIn of checkIns) {
      if (checkIn.outcome === WORSENED_OUTCOME) {
        currentRun++;
        maxRun = Math.max(maxRun, currentRun);
      } else {
        currentRun = 0;
      }
    }
    return maxRun;
  }
}
