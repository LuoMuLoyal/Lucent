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
import { BaselineDimension } from '../../../types/baseline.types.js';
import { symptomSeverityScore } from '../../../constants/symptom-severity.constants.js';
import {
  TREND_MIN_CONSECUTIVE_DAYS,
  TREND_MIN_RECORDS,
  DETERIORATING_TREND_BASE_SCORE,
} from '../../../constants/thresholds.constants.js';

interface SymptomEntry {
  date: string;
  /** 症状目录码（payload `symptom`）；无码记录不参与判定。 */
  symptom: string | null;
  /** 严重度码（payload `severity`）；`unknown` 表示判断不了，按无观测处理。 */
  severity: string | null;
  title: string;
  value: string | null;
}

/**
 * Rule: deteriorating_symptom
 * Type: TREND
 * Trigger: TIMER
 *
 * Fires when symptom records show a deteriorating trend over
 * the last 7 days — at least 2 consecutive days of increasing
 * severity and at least 3 total records.
 *
 * 严重度只认结构化码（payload `severity`），按 payload `symptom` 分组；
 * 不再从 `value` / `note` 的文本里猜数字或关键词——那条启发式对客户端实际写入的
 * 本地化文案（"轻度" / "Mild"）从不命中，导致规则长期恒不触发。
 */
@Injectable()
export class DeterioratingTrendRuleService implements SuggestionRule {
  readonly ruleId = 'deteriorating_symptom';
  readonly ruleVersion = '1.0.0';
  readonly type = SuggestionType.TREND;
  readonly triggerType = TriggerType.TIMER;
  readonly isBaselineRequired = true;
  readonly baselineDimensions = [BaselineDimension.SYMPTOM_SEVERITY];
  readonly consumableSignalKinds = ['symptom_trend'];

  match(
    signals: SuggestionSignal[],
    _context: RuleContext,
  ): SuggestionCandidate | null {
    const trendSignal = signals.find(
      (s) => s.kind === 'symptom_trend' && s.source === 'record',
    );

    if (trendSignal == null) {
      return null;
    }

    const byDate = trendSignal.payload['byDate'] as SymptomEntry[] | null;
    const totalRecords = trendSignal.payload['totalRecords'] as number;

    if (totalRecords < TREND_MIN_RECORDS) {
      return null;
    }
    if (byDate == null) {
      return null;
    }

    // Group by symptom catalog code — 换语言只改 title，码不变，因此不会把同一
    // 症状拆成两组。
    const bySymptom = new Map<string, SymptomEntry[]>();
    for (const entry of byDate) {
      const code = entry.symptom;
      if (code == null || code.length === 0) continue;
      const existing = bySymptom.get(code) ?? [];
      existing.push(entry);
      bySymptom.set(code, existing);
    }

    for (const [code, entries] of bySymptom) {
      if (entries.length < TREND_MIN_CONSECUTIVE_DAYS) continue;

      // Sort by date ascending
      entries.sort((a, b) => a.date.localeCompare(b.date));

      // Check if severity is increasing
      const severities = entries.map((e) => symptomSeverityScore(e.severity));
      const isDeteriorating = this.checkDeterioration(severities);

      if (!isDeteriorating) continue;

      const latestEntry = entries[entries.length - 1];
      const latestValue = latestEntry?.value ?? '--';
      const symptomTitle = latestEntry?.title.trim() ?? '';
      const daysCount = entries.length;

      return {
        candidateId: randomUUID(),
        ruleId: this.ruleId,
        ruleVersion: this.ruleVersion,
        type: this.type,
        triggerType: this.triggerType,
        evidence: [
          {
            kind: 'trend',
            label: 'latest_severity',
            value: latestValue,
          },
          {
            kind: 'trend',
            label: 'trend_direction',
            value: 'worsening',
          },
          {
            kind: 'trend',
            label: 'consecutive_days',
            value: String(daysCount),
          },
        ],
        primaryAction: {
          actionId: 'go_record_symptom',
          label: 'record_symptom',
          route: '/record/create?kind=symptom',
          authRequired: true,
        },
        priorityScore: DETERIORATING_TREND_BASE_SCORE,
        confidence:
          daysCount >= 4
            ? SuggestionConfidence.HIGH
            : SuggestionConfidence.MEDIUM,
        notificationEligible: false,
        subtype: 'symptom',
        copyGeneration: {
          templateKey: 'symptom.deteriorating.trend',
          params: {
            symptomTitle: symptomTitle.length === 0 ? code : symptomTitle,
            daysCount,
            latestValue,
            totalRecords,
            confidence: daysCount >= 4 ? 'high' : 'medium',
          },
        },
      };
    }

    return null;
  }

  /**
   * 判断严重度序列是否在恶化。
   *
   * `null`（`unknown` 或没有码）在 `map` 阶段已经被过滤掉，不再参与比较，
   * 也不会回落成最小严重度：把"说不清"当成"很轻"会让趋势判断失真。
   */
  private checkDeterioration(severities: Array<number | null>): boolean {
    const known = severities.filter((value): value is number => value != null);
    if (known.length < 2) return false;
    let increasingCount = 0;
    for (let i = 1; i < known.length; i++) {
      const current = known[i];
      const previous = known[i - 1];
      if (current != null && previous != null && current > previous) {
        increasingCount++;
      }
    }
    // At least half the transitions should be increasing
    return increasingCount >= Math.ceil((known.length - 1) / 2);
  }
}
