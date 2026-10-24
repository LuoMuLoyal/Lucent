import { randomUUID } from 'node:crypto';
import type { SuggestionRule, RuleContext } from '../../../types/rule.types.js';

import type { SuggestionSignal } from '../../../types/signal.types.js';

import type { SuggestionCandidate } from '../../../types/candidate.types.js';
import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from '../../../types/suggestion.types.js';
import { BaselineDimension } from '../../../types/baseline.types.js';
import {
  SLEEP_SHORTFALL_BASE_SCORE,
  SLEEP_SHORTFALL_MINUTES,
  SLEEP_SHORTFALL_MIN_DAYS,
  MINUTES_PER_HOUR,
} from '../../../domain/rule/thresholds.js';

/**
 * Rule: sleep_shortfall
 * Type: BEHAVIOR_ADVICE
 * Trigger: TIMER
 *
 * Fires when the most recent sleep record shows a duration
 * below 6 hours AND the user has at least 2 days of sleep records.
 */
export class SleepShortfallRuleService implements SuggestionRule {
  readonly ruleId = 'sleep_shortfall';
  readonly ruleVersion = '1.0.0';
  readonly type = SuggestionType.BEHAVIOR_ADVICE;
  readonly triggerType = TriggerType.TIMER;
  readonly isBaselineRequired = true;
  readonly baselineDimensions = [BaselineDimension.SLEEP_DURATION];
  readonly consumableSignalKinds = ['sleep_record', 'sleep_trend'];

  match(
    signals: SuggestionSignal[],
    _context: RuleContext,
  ): SuggestionCandidate | null {
    const sleepSignal = signals.find(
      (s) => s.kind === 'sleep_record' && s.source === 'record',
    );
    const sleepTrendSignal = signals.find(
      (s) => s.kind === 'sleep_trend' && s.source === 'record',
    );

    if (sleepSignal == null) {
      return null;
    }

    const durationMinutes = sleepSignal.payload['durationMinutes'] as
      | number
      | null;
    if (durationMinutes == null || durationMinutes <= 0) {
      return null;
    }

    if (durationMinutes >= SLEEP_SHORTFALL_MINUTES) {
      return null;
    }

    // Check baseline: need at least N consecutive days
    const consecutiveDays = sleepTrendSignal?.payload[
      'consecutiveDays'
    ] as number;
    if (consecutiveDays < SLEEP_SHORTFALL_MIN_DAYS) {
      return null;
    }

    const hours = Math.floor(durationMinutes / MINUTES_PER_HOUR);
    const mins = durationMinutes % MINUTES_PER_HOUR;

    return {
      candidateId: randomUUID(),
      ruleId: this.ruleId,
      ruleVersion: this.ruleVersion,
      type: this.type,
      triggerType: this.triggerType,
      evidence: [
        {
          kind: 'record',
          label: 'sleep_duration',
          value: `${String(hours)}h ${String(mins)}m`,
        },
        {
          kind: 'baseline',
          label: 'recent_days',
          value: String(consecutiveDays),
        },
      ],
      primaryAction: {
        actionId: 'go_record_sleep',
        label: 'record_sleep',
        route: '/record/create?kind=sleep',
        authRequired: true,
      },
      priorityScore: SLEEP_SHORTFALL_BASE_SCORE,
      confidence: SuggestionConfidence.MEDIUM,
      notificationEligible: false,
      subtype: 'sleep',
      copyGeneration: {
        templateKey: 'sleep.shortfall',
        params: {
          hours,
          mins,
          durationMinutes,
          consecutiveDays,
        },
      },
    };
  }
}
