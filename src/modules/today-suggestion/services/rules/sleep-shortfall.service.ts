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
import { BaselineDimension } from '../../types/baseline.types';
import {
  SLEEP_SHORTFALL_BASE_SCORE,
  SLEEP_SHORTFALL_MINUTES,
  SLEEP_SHORTFALL_MIN_DAYS,
} from '../../constants/thresholds.constants';

/**
 * Rule: sleep_shortfall
 * Type: BEHAVIOR_ADVICE
 * Trigger: TIMER
 *
 * Fires when the most recent sleep record shows a duration
 * below 6 hours AND the user has at least 2 days of sleep records.
 */
@Injectable()
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

    const hours = Math.floor(durationMinutes / 60);
    const mins = durationMinutes % 60;

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
