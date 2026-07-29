import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { SuggestionRule, RuleContext } from '../../../types/rule.types';

import type { SuggestionSignal } from '../../../types/signal.types';

import type { SuggestionCandidate } from '../../../types/candidate.types';
import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from '../../../types/suggestion.types';
import { BaselineDimension } from '../../../types/baseline.types';
import {
  WATER_SHORTFALL_THRESHOLD,
  WATER_SHORTFALL_BASE_SCORE,
  WATER_SHORTFALL_MIN_DAYS,
} from '../../../constants/thresholds.constants';

/**
 * Rule: water_behind_target
 * Type: BEHAVIOR_ADVICE
 * Trigger: TIMER
 *
 * Fires when the user's water intake is below 50% of target
 * AND it is afternoon or later AND the user has at least 2 days
 * of recent water records (baseline check).
 */
@Injectable()
export class WaterShortfallRuleService implements SuggestionRule {
  readonly ruleId = 'water_behind_target';
  readonly ruleVersion = '1.0.0';
  readonly type = SuggestionType.BEHAVIOR_ADVICE;
  readonly triggerType = TriggerType.TIMER;
  readonly isBaselineRequired = true;
  readonly baselineDimensions = [BaselineDimension.WATER_INTAKE];
  readonly consumableSignalKinds = ['water_count', 'water_trend'];

  match(
    signals: SuggestionSignal[],
    context: RuleContext,
  ): SuggestionCandidate | null {
    const waterCountSignal = signals.find(
      (s) => s.kind === 'water_count' && s.source === 'record',
    );
    const waterTrendSignal = signals.find(
      (s) => s.kind === 'water_trend' && s.source === 'record',
    );

    if (waterCountSignal == null) {
      return null;
    }

    const completedCount = waterCountSignal.payload['completedCount'] as number;
    const targetCount = waterCountSignal.payload['targetCount'] as number;
    const remainingCount = waterCountSignal.payload['remainingCount'] as number;

    // Only fire if water is below threshold
    if (
      targetCount === 0 ||
      completedCount / targetCount >= WATER_SHORTFALL_THRESHOLD
    ) {
      return null;
    }

    // Only fire in afternoon or later
    if (context.timeOfDay === 'morning') {
      return null;
    }

    // Check baseline: need at least N consecutive days of water records
    const consecutiveDays = waterTrendSignal?.payload[
      'consecutiveDays'
    ] as number;
    if (consecutiveDays < WATER_SHORTFALL_MIN_DAYS) {
      return null;
    }

    return {
      candidateId: randomUUID(),
      ruleId: this.ruleId,
      ruleVersion: this.ruleVersion,
      type: this.type,
      triggerType: this.triggerType,
      evidence: [
        {
          kind: 'record',
          label: 'current_count',
          value: String(completedCount),
        },
        {
          kind: 'record',
          label: 'target_count',
          value: String(targetCount),
        },
        {
          kind: 'baseline',
          label: 'recent_days',
          value: String(consecutiveDays),
        },
      ],
      primaryAction: {
        actionId: 'go_record_water',
        label: 'go_record',
        route: '/record/create?kind=water',
        authRequired: true,
      },
      priorityScore: WATER_SHORTFALL_BASE_SCORE,
      confidence: SuggestionConfidence.MEDIUM,
      notificationEligible: false,
      subtype: 'water',
      copyGeneration: {
        templateKey: 'water.behind.target',
        params: {
          completedCount,
          targetCount,
          remainingCount,
          completionRate: Math.round((completedCount / targetCount) * 100),
          consecutiveDays,
        },
      },
    };
  }
}
