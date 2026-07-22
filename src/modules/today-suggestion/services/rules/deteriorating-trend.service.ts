import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  SuggestionRule,
  SuggestionSignal,
  RuleContext,
  SuggestionCandidate,
} from '../../types';
import { SuggestionType, TriggerType, SuggestionConfidence } from '../../types';
import { BaselineDimension } from '../../types';
import {
  TREND_MIN_CONSECUTIVE_DAYS,
  TREND_MIN_RECORDS,
  DETERIORATING_TREND_BASE_SCORE,
} from '../../constants';

interface SymptomEntry {
  date: string;
  title: string;
  value: string | null;
  note: string | null;
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
 * Severity is inferred from the `value` field if it contains
 * a numeric severity (e.g. "3/5", "7/10") or from the title/note
 * containing keywords like "加重", "恶化", "worse".
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

    // Group by symptom title and check for deterioration
    const byTitle = new Map<string, SymptomEntry[]>();
    for (const entry of byDate) {
      const title = entry.title.trim();
      if (title.length === 0) continue;
      const existing = byTitle.get(title) ?? [];
      existing.push(entry);
      byTitle.set(title, existing);
    }

    for (const [title, entries] of byTitle) {
      if (entries.length < TREND_MIN_CONSECUTIVE_DAYS) continue;

      // Sort by date ascending
      entries.sort((a, b) => a.date.localeCompare(b.date));

      // Check if severity is increasing
      const severities = entries.map((e) => this.extractSeverity(e));
      const isDeteriorating = this.checkDeterioration(severities);

      if (!isDeteriorating) continue;

      const latestEntry = entries[entries.length - 1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const latestValue = latestEntry.value ?? '--';
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
            label: '最新严重度',
            value: latestValue,
          },
          {
            kind: 'trend',
            label: '趋势方向',
            value: '加重',
          },
          {
            kind: 'trend',
            label: '连续天数',
            value: `${String(daysCount)} 天`,
          },
        ],
        primaryAction: {
          actionId: 'go_record_symptom',
          label: '记录症状',
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
            symptomTitle: title,
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
   * Extracts a numeric severity from a symptom entry.
   * Supports patterns like "3/5", "7/10", "severity: 4".
   * Returns 0 if no numeric severity is found.
   */
  private extractSeverity(entry: SymptomEntry): number {
    // Try value field first
    if (entry.value != null) {
      const num = this.parseSeverity(entry.value);
      if (num != null) return num;
    }

    // Try note field
    if (entry.note != null) {
      const num = this.parseSeverity(entry.note);
      if (num != null) return num;

      // Check for keyword-based severity
      const lower = entry.note.toLowerCase();
      if (
        lower.includes('加重') ||
        lower.includes('恶化') ||
        lower.includes('worse')
      ) {
        return 5;
      }
      if (lower.includes('严重') || lower.includes('severe')) {
        return 4;
      }
      if (lower.includes('中等') || lower.includes('moderate')) {
        return 3;
      }
      if (lower.includes('轻微') || lower.includes('mild')) {
        return 2;
      }
    }

    return 1; // default minimal severity
  }

  private parseSeverity(text: string): number | null {
    // Match "N/M" pattern
    const fractionMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (fractionMatch) {
      return parseInt(fractionMatch[1]!, 10); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
    // Match standalone number
    const numMatch = text.match(/(\d+)/);
    if (numMatch) {
      return parseInt(numMatch[1]!, 10); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
    return null;
  }

  private checkDeterioration(severities: number[]): boolean {
    if (severities.length < 2) return false;
    let increasingCount = 0;
    for (let i = 1; i < severities.length; i++) {
      const current = severities[i];
      const previous = severities[i - 1];
      if (current != null && previous != null && current > previous) {
        increasingCount++;
      }
    }
    // At least half the transitions should be increasing
    return increasingCount >= Math.ceil((severities.length - 1) / 2);
  }
}
