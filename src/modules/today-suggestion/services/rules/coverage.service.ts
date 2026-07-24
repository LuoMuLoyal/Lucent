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
import { COVERAGE_BASE_SCORE } from '../../constants/thresholds.constants';

/**
 * Rule: coverage_explanation
 * Type: COVERAGE
 * Trigger: TIMER
 *
 * Fires when the user's health profile is incomplete
 * (missing birthDate, sexAtBirth, or heightCm) OR
 * when there are zero records today.
 */
@Injectable()
export class CoverageRuleService implements SuggestionRule {
  readonly ruleId = 'coverage_explanation';
  readonly ruleVersion = '1.0.0';
  readonly type = SuggestionType.COVERAGE;
  readonly triggerType = TriggerType.TIMER;
  readonly isBaselineRequired = false;
  readonly consumableSignalKinds = ['profile_completeness', 'record_density'];

  match(
    signals: SuggestionSignal[],
    _context: RuleContext,
  ): SuggestionCandidate | null {
    const profileSignal = signals.find(
      (s) => s.kind === 'profile_completeness' && s.source === 'profile',
    );
    const densitySignal = signals.find(
      (s) => s.kind === 'record_density' && s.source === 'record',
    );

    // Case 1: profile is incomplete
    if (profileSignal != null) {
      const missingFields = profileSignal.payload['missingFields'] as string[];
      const isComplete = profileSignal.payload['isComplete'] as boolean;

      if (!isComplete && missingFields.length > 0) {
        return {
          candidateId: randomUUID(),
          ruleId: this.ruleId,
          ruleVersion: this.ruleVersion,
          type: this.type,
          triggerType: this.triggerType,
          evidence: [
            {
              kind: 'profile',
              label: 'missing_fields',
              value: missingFields.join(','),
            },
          ],
          primaryAction: {
            actionId: 'go_complete_profile',
            label: 'complete_profile',
            route: '/mine/profile/edit',
            authRequired: true,
          },
          priorityScore: COVERAGE_BASE_SCORE,
          confidence: SuggestionConfidence.HIGH,
          notificationEligible: false,
          subtype: 'profile',
          copyGeneration: {
            templateKey: 'coverage.profile.incomplete',
            params: {
              missingFields: missingFields.join(','),
              fieldCount: missingFields.length,
            },
          },
        };
      }
    }

    // Case 2: no records today
    if (densitySignal != null) {
      const todayCount = densitySignal.payload['todayCount'] as number;
      if (todayCount === 0) {
        return {
          candidateId: randomUUID(),
          ruleId: this.ruleId,
          ruleVersion: this.ruleVersion,
          type: this.type,
          triggerType: this.triggerType,
          evidence: [
            {
              kind: 'record',
              label: 'today_record_count',
              value: '0',
            },
          ],
          primaryAction: {
            actionId: 'go_record',
            label: 'go_record',
            route: '/record',
            authRequired: true,
          },
          priorityScore: COVERAGE_BASE_SCORE - 50,
          confidence: SuggestionConfidence.HIGH,
          notificationEligible: false,
          subtype: 'empty_today',
          copyGeneration: {
            templateKey: 'coverage.record.empty_today',
            params: {
              todayCount: 0,
            },
          },
        };
      }
    }

    return null;
  }
}
