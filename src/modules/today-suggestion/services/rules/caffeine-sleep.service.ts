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
  CAFFEINE_SLEEP_BASE_SCORE,
  CAFFEINE_SLEEP_MIN_DAYS,
  CAFFEINE_SLEEP_DECLINE_MINUTES,
} from '../../constants/thresholds.constants';

interface DailyIntake {
  date: string;
  count: number;
}

interface DailyDuration {
  date: string;
  durationMinutes: number | null;
}

/**
 * Rule: caffeine_sleep_correlation
 * Type: BEHAVIOR_ADVICE
 * Trigger: TIMER
 *
 * Fires when the user has both caffeine intake records and sleep
 * records showing a decline in sleep duration, and the sleep
 * duration is below the user's baseline.
 *
 * This rule combines two signal kinds:
 * - caffeine_trend: daily caffeine intake counts
 * - sleep_trend: daily sleep durations
 *
 * The correlation logic checks:
 * 1. At least CAFFEINE_SLEEP_MIN_DAYS of caffeine records
 * 2. Sleep duration declining by at least CAFFEINE_SLEEP_DECLINE_MINUTES
 *    over the look-back period
 * 3. Most recent sleep duration below 6 hours (SLEEP_SHORTFALL_MINUTES)
 */
@Injectable()
export class CaffeineSleepRuleService implements SuggestionRule {
  readonly ruleId = 'caffeine_sleep_correlation';
  readonly ruleVersion = '1.0.0';
  readonly type = SuggestionType.BEHAVIOR_ADVICE;
  readonly triggerType = TriggerType.TIMER;
  readonly isBaselineRequired = true;
  readonly baselineDimensions = [
    BaselineDimension.CAFFEINE_INTAKE,
    BaselineDimension.SLEEP_DURATION,
  ];
  readonly consumableSignalKinds = ['caffeine_trend', 'sleep_trend'];

  match(
    signals: SuggestionSignal[],
    _context: RuleContext,
  ): SuggestionCandidate | null {
    const caffeineSignal = signals.find(
      (s) => s.kind === 'caffeine_trend' && s.source === 'record',
    );
    const sleepTrendSignal = signals.find(
      (s) => s.kind === 'sleep_trend' && s.source === 'record',
    );

    if (caffeineSignal == null || sleepTrendSignal == null) {
      return null;
    }

    const dailyIntakes = caffeineSignal.payload['dailyIntakes'] as
      | DailyIntake[]
      | null;
    const caffeineDays = caffeineSignal.payload['consecutiveDays'] as number;

    if (dailyIntakes == null || caffeineDays < CAFFEINE_SLEEP_MIN_DAYS) {
      return null;
    }

    const dailyDurations = sleepTrendSignal.payload['dailyDurations'] as
      | DailyDuration[]
      | null;
    if (dailyDurations == null || dailyDurations.length < 2) {
      return null;
    }

    // Check if sleep duration is declining
    const sortedDurations = [...dailyDurations].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const decline = this.calculateDecline(sortedDurations);
    if (decline < CAFFEINE_SLEEP_DECLINE_MINUTES) {
      return null;
    }

    // Check if the most recent sleep is below 6 hours
    const latestDuration =
      sortedDurations[sortedDurations.length - 1]?.durationMinutes;
    if (latestDuration == null || latestDuration >= 360) {
      return null;
    }

    // Check if caffeine intake is on the same days as sleep decline
    const caffeineDates = new Set(dailyIntakes.map((d) => d.date));
    const sleepDates = new Set(sortedDurations.map((d) => d.date));
    const overlappingDates = Array.from(caffeineDates).filter((d) =>
      sleepDates.has(d),
    );
    if (overlappingDates.length < CAFFEINE_SLEEP_MIN_DAYS) {
      return null;
    }

    const totalCaffeine = dailyIntakes.reduce((sum, d) => sum + d.count, 0);
    const hours = Math.floor(latestDuration / 60);
    const mins = latestDuration % 60;

    return {
      candidateId: randomUUID(),
      ruleId: this.ruleId,
      ruleVersion: this.ruleVersion,
      type: this.type,
      triggerType: this.triggerType,
      evidence: [
        {
          kind: 'record',
          label: 'caffeine_record_days',
          value: String(caffeineDays),
        },
        {
          kind: 'record',
          label: 'caffeine_total_count',
          value: String(totalCaffeine),
        },
        {
          kind: 'trend',
          label: 'sleep_decline',
          value: String(decline),
        },
        {
          kind: 'record',
          label: 'latest_sleep_duration',
          value: `${String(hours)}h ${String(mins)}m`,
        },
      ],
      primaryAction: {
        actionId: 'go_record_meal',
        label: 'record_meal',
        route: '/record/create?kind=meal',
        authRequired: true,
      },
      priorityScore: CAFFEINE_SLEEP_BASE_SCORE,
      confidence: SuggestionConfidence.MEDIUM,
      notificationEligible: false,
      subtype: 'caffeine',
      copyGeneration: {
        templateKey: 'caffeine.sleep.correlation',
        params: {
          caffeineDays,
          totalCaffeine,
          decline,
          hours,
          mins,
          latestDuration,
          overlappingDays: overlappingDates.length,
        },
      },
    };
  }

  /**
   * Calculates the total decline in sleep duration from the
   * highest point to the most recent value.
   */
  private calculateDecline(durations: DailyDuration[]): number {
    const valid = durations.filter(
      (d): d is DailyDuration & { durationMinutes: number } =>
        d.durationMinutes != null,
    );
    if (valid.length < 2) return 0;

    const max = Math.max(...valid.map((d) => d.durationMinutes));
    const latest = valid[valid.length - 1]!.durationMinutes; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    return Math.max(max - latest, 0);
  }
}
