import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  SuggestionRule,
  SuggestionSignal,
  RuleContext,
  SuggestionCandidate,
} from '../../types';
import { SuggestionType, TriggerType, SuggestionConfidence } from '../../types';
import { COVERAGE_BASE_SCORE } from '../../constants';

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
        const fieldLabels: Record<string, string> = {
          birthDate: '出生日期',
          sexAtBirth: '出生性别',
          heightCm: '身高',
        };
        const missingLabels = missingFields.map((f) => fieldLabels[f] ?? f);

        return {
          candidateId: randomUUID(),
          ruleId: this.ruleId,
          ruleVersion: this.ruleVersion,
          type: this.type,
          triggerType: this.triggerType,
          title: '健康档案信息不完整',
          reason: `缺少 ${missingLabels.join('、')}，完善后可获得更准确的建议。`,
          evidence: [
            {
              kind: 'profile',
              label: '缺失字段',
              value: missingLabels.join('、'),
            },
          ],
          boundary: '完善档案有助于提供更准确的个性化建议。',
          primaryAction: {
            actionId: 'go_complete_profile',
            label: '完善档案',
            route: '/mine/health-context',
            authRequired: true,
          },
          priorityScore: COVERAGE_BASE_SCORE,
          confidence: SuggestionConfidence.HIGH,
          notificationEligible: false,
          subtype: 'profile',
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
          title: '今日还没有记录',
          reason: '记录饮水、症状或睡眠后，系统可以生成更有针对性的建议。',
          evidence: [
            {
              kind: 'record',
              label: '今日记录数',
              value: '0',
            },
          ],
          boundary: '数据不足时，系统只能提供通用建议。',
          primaryAction: {
            actionId: 'go_record',
            label: '去记录',
            route: '/record',
            authRequired: true,
          },
          priorityScore: COVERAGE_BASE_SCORE - 50,
          confidence: SuggestionConfidence.HIGH,
          notificationEligible: false,
          subtype: 'empty_today',
        };
      }
    }

    return null;
  }
}
