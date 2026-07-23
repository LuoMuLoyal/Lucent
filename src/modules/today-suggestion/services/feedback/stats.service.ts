import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma';

/** Statistics for a single rule's feedback. */
export interface RuleFeedbackStats {
  ruleId: string;
  totalFeedback: number;
  acceptedCount: number;
  laterCount: number;
  notApplicableCount: number;
  suppressCount: number;
  /** Accept ratio: accepted / total (0–1). */
  acceptRatio: number;
  /** Suppress ratio: suppress / total (0–1). */
  suppressRatio: number;
  /** Dynamic score adjustment multiplier (0.5–1.5). */
  scoreMultiplier: number;
}

/** Default lookback window for feedback stats (days). */
const STATS_LOOKBACK_DAYS = 30;

/** Minimum feedback count before adjustments kick in. */
const STATS_MIN_SAMPLE_SIZE = 5;

/** Maximum score multiplier boost (for very high accept rate). */
const MAX_BOOST_MULTIPLIER = 1.5;

/** Maximum score reduction (for very high suppress rate). */
const MIN_REDUCTION_MULTIPLIER = 0.5;

/**
 * Tracks feedback statistics per rule and computes dynamic
 * score multipliers for threshold adjustments.
 *
 * Rules with high suppress rates get their base scores reduced,
 * while rules with high accept rates get boosted.
 *
 * This service is called by the suppression layer to apply
 * data-driven adjustments on top of the static priority scores.
 */
@Injectable()
export class FeedbackStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads feedback statistics for the given rule IDs over the
   * past N days. Returns a map of ruleId → stats.
   */
  async loadStats(
    userId: string,
    ruleIds: string[],
  ): Promise<Map<string, RuleFeedbackStats>> {
    if (ruleIds.length === 0) {
      return new Map();
    }

    const lookbackDate = new Date();
    lookbackDate.setUTCDate(lookbackDate.getUTCDate() - STATS_LOOKBACK_DAYS);

    // Query feedback records
    const feedbacks = await this.prisma.userSuggestionFeedback.findMany({
      where: {
        userId,
        appliedAt: { gte: lookbackDate },
      },
      select: {
        feedback: true,
        suggestionId: true,
      },
    });

    if (feedbacks.length === 0) {
      return new Map();
    }

    // Fetch associated suggestions for ruleId
    const suggestionIds = [...new Set(feedbacks.map((f) => f.suggestionId))];
    const suggestions = await this.prisma.userSuggestion.findMany({
      where: { id: { in: suggestionIds } },
      select: { id: true, ruleId: true },
    });
    const suggestionRuleMap = new Map(suggestions.map((s) => [s.id, s.ruleId]));

    // Aggregate by ruleId
    const buckets = new Map<
      string,
      {
        accepted: number;
        later: number;
        notApplicable: number;
        suppress: number;
      }
    >();

    for (const f of feedbacks) {
      const ruleId = suggestionRuleMap.get(f.suggestionId);
      if (ruleId == null) continue;
      if (!ruleIds.includes(ruleId)) continue;

      const bucket = buckets.get(ruleId) ?? {
        accepted: 0,
        later: 0,
        notApplicable: 0,
        suppress: 0,
      };

      switch (f.feedback) {
        case 'accepted':
          bucket.accepted++;
          break;
        case 'later':
          bucket.later++;
          break;
        case 'not_applicable':
          bucket.notApplicable++;
          break;
        case 'suppress':
          bucket.suppress++;
          break;
      }
      buckets.set(ruleId, bucket);
    }

    const result = new Map<string, RuleFeedbackStats>();
    for (const [ruleId, bucket] of buckets.entries()) {
      const total =
        bucket.accepted + bucket.later + bucket.notApplicable + bucket.suppress;

      if (total < STATS_MIN_SAMPLE_SIZE) {
        // Not enough data — use neutral multiplier
        result.set(ruleId, {
          ruleId,
          totalFeedback: total,
          acceptedCount: bucket.accepted,
          laterCount: bucket.later,
          notApplicableCount: bucket.notApplicable,
          suppressCount: bucket.suppress,
          acceptRatio: total > 0 ? bucket.accepted / total : 0,
          suppressRatio: total > 0 ? bucket.suppress / total : 0,
          scoreMultiplier: 1.0,
        });
        continue;
      }

      const acceptRatio = bucket.accepted / total;
      const suppressRatio = bucket.suppress / total;

      // Compute multiplier:
      // - High accept ratio → boost (up to 1.5)
      // - High suppress ratio → reduce (down to 0.5)
      // - Neutral area (around 0.5 accept, 0.0 suppress) → 1.0
      const boostFromAccept = acceptRatio * 0.5; // 0–0.5
      const reductionFromSuppress = suppressRatio * 0.5; // 0–0.5
      const multiplier = Math.max(
        MIN_REDUCTION_MULTIPLIER,
        Math.min(
          MAX_BOOST_MULTIPLIER,
          1.0 + boostFromAccept - reductionFromSuppress,
        ),
      );

      result.set(ruleId, {
        ruleId,
        totalFeedback: total,
        acceptedCount: bucket.accepted,
        laterCount: bucket.later,
        notApplicableCount: bucket.notApplicable,
        suppressCount: bucket.suppress,
        acceptRatio,
        suppressRatio,
        scoreMultiplier: Math.round(multiplier * 100) / 100,
      });
    }

    return result;
  }
}
