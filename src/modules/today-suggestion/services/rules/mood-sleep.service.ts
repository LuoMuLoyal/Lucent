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
  MOOD_SLEEP_BASE_SCORE,
  MOOD_SLEEP_MIN_DAYS,
  MOOD_LOW_THRESHOLD,
} from '../../constants';

interface DailyMood {
  date: string;
  moodScore: number;
  label: string;
}

interface DailyDuration {
  date: string;
  durationMinutes: number | null;
}

/**
 * Rule: mood_sleep_correlation
 * Type: BEHAVIOR_ADVICE
 * Trigger: TIMER
 *
 * Fires when the user has both mood records showing low mood and sleep
 * records showing insufficient duration, with overlapping dates.
 *
 * This rule combines two signal kinds:
 * - mood_trend: daily mood scores (1–5 scale)
 * - sleep_trend: daily sleep durations
 *
 * The correlation logic checks:
 * 1. At least MOOD_SLEEP_MIN_DAYS of mood records
 * 2. Most recent mood score is low (≤ MOOD_LOW_THRESHOLD)
 * 3. Most recent sleep duration is below 6 hours
 * 4. Mood and sleep dates overlap
 */
@Injectable()
export class MoodSleepRuleService implements SuggestionRule {
  readonly ruleId = 'mood_sleep_correlation';
  readonly ruleVersion = '1.0.0';
  readonly type = SuggestionType.BEHAVIOR_ADVICE;
  readonly triggerType = TriggerType.TIMER;
  readonly isBaselineRequired = true;
  readonly baselineDimensions = [
    BaselineDimension.MOOD,
    BaselineDimension.SLEEP_DURATION,
  ];
  readonly consumableSignalKinds = ['mood_trend', 'sleep_trend'];

  match(
    signals: SuggestionSignal[],
    _context: RuleContext,
  ): SuggestionCandidate | null {
    const moodSignal = signals.find(
      (s) => s.kind === 'mood_trend' && s.source === 'record',
    );
    const sleepTrendSignal = signals.find(
      (s) => s.kind === 'sleep_trend' && s.source === 'record',
    );

    if (moodSignal == null || sleepTrendSignal == null) {
      return null;
    }

    const dailyMoods = moodSignal.payload['dailyMoods'] as DailyMood[] | null;
    const moodDays = moodSignal.payload['consecutiveDays'] as number;

    if (dailyMoods == null || moodDays < MOOD_SLEEP_MIN_DAYS) {
      return null;
    }

    const dailyDurations = sleepTrendSignal.payload['dailyDurations'] as
      | DailyDuration[]
      | null;
    if (dailyDurations == null || dailyDurations.length < 2) {
      return null;
    }

    // Check most recent mood is low
    const sortedMoods = [...dailyMoods].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const latestMood = sortedMoods[sortedMoods.length - 1];
    if (latestMood == null || latestMood.moodScore > MOOD_LOW_THRESHOLD) {
      return null;
    }

    // Check most recent sleep is below 6 hours
    const sortedDurations = [...dailyDurations].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const latestDuration =
      sortedDurations[sortedDurations.length - 1]?.durationMinutes;
    if (latestDuration == null || latestDuration >= 360) {
      return null;
    }

    // Check date overlap
    const moodDates = new Set(sortedMoods.map((m) => m.date));
    const sleepDates = new Set(sortedDurations.map((d) => d.date));
    const overlappingDates = Array.from(moodDates).filter((d) =>
      sleepDates.has(d),
    );
    if (overlappingDates.length < MOOD_SLEEP_MIN_DAYS) {
      return null;
    }

    const hours = Math.floor(latestDuration / 60);
    const mins = latestDuration % 60;
    const avgMood = (
      sortedMoods.reduce((sum, m) => sum + m.moodScore, 0) / sortedMoods.length
    ).toFixed(1);

    return {
      candidateId: randomUUID(),
      ruleId: this.ruleId,
      ruleVersion: this.ruleVersion,
      type: this.type,
      triggerType: this.triggerType,
      evidence: [
        {
          kind: 'record',
          label: '最新情绪评分',
          value: `${String(latestMood.moodScore)}/5 (${latestMood.label})`,
        },
        {
          kind: 'record',
          label: '平均情绪评分',
          value: `${avgMood}/5`,
        },
        {
          kind: 'record',
          label: '最新睡眠时长',
          value: `${String(hours)}h ${String(mins)}m`,
        },
        {
          kind: 'baseline',
          label: '情绪记录天数',
          value: `${String(moodDays)} 天`,
        },
      ],
      primaryAction: {
        actionId: 'go_record_mood',
        label: '记录情绪',
        route: '/record/create?kind=mood',
        authRequired: true,
      },
      priorityScore: MOOD_SLEEP_BASE_SCORE,
      confidence: SuggestionConfidence.MEDIUM,
      notificationEligible: false,
      subtype: 'mood',
      copyGeneration: {
        templateKey: 'mood.sleep.correlation',
        params: {
          avgMood,
          latestMoodScore: latestMood.moodScore,
          latestMoodLabel: latestMood.label,
          hours,
          mins,
          durationMinutes: latestDuration,
          moodDays,
          overlappingDays: overlappingDates.length,
        },
      },
    };
  }
}
