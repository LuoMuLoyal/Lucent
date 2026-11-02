import {
  feedbackRatios,
  scoreMultiplier,
} from '../../feedback/score-multiplier.js';

/** One feedback row inside the statistics lookback window. */
export interface FeedbackRuleRow {
  suggestionId: string;
  feedback: string;
  appliedAt: Date;
  ruleId: string;
}

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

/**
 * Aggregates loaded feedback rows into per-rule statistics.
 *
 * Pure: the rows and the requested rule IDs are supplied by the caller.
 * The multiplier itself is the domain rule `scoreMultiplier` — this only
 * assembles the counts it needs.
 */
export function computeRuleStats(
  rows: FeedbackRuleRow[],
  ruleIds: string[],
): Map<string, RuleFeedbackStats> {
  if (rows.length === 0 || ruleIds.length === 0) {
    return new Map();
  }

  const wanted = new Set(ruleIds);
  const buckets = new Map<
    string,
    {
      accepted: number;
      later: number;
      notApplicable: number;
      suppress: number;
    }
  >();

  for (const row of rows) {
    if (!wanted.has(row.ruleId)) continue;

    const bucket = buckets.get(row.ruleId) ?? {
      accepted: 0,
      later: 0,
      notApplicable: 0,
      suppress: 0,
    };

    switch (row.feedback) {
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
    buckets.set(row.ruleId, bucket);
  }

  const result = new Map<string, RuleFeedbackStats>();
  for (const [ruleId, bucket] of buckets.entries()) {
    const ratios = feedbackRatios(bucket);

    result.set(ruleId, {
      ruleId,
      totalFeedback: ratios.total,
      acceptedCount: bucket.accepted,
      laterCount: bucket.later,
      notApplicableCount: bucket.notApplicable,
      suppressCount: bucket.suppress,
      acceptRatio: ratios.acceptRatio,
      suppressRatio: ratios.suppressRatio,
      scoreMultiplier: scoreMultiplier(ratios),
    });
  }

  return result;
}
