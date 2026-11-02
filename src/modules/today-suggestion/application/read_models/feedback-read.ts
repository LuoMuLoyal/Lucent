import { Inject, Injectable } from '@nestjs/common';
import { now } from '../../../../common/index.js';
import {
  SuggestionFeedback,
  SuggestionType,
} from '../../domain/suggestion/suggestion.types.js';
import { computeRuleStats } from '../../domain/policies/feedback/feedback-stats.js';
import type { RuleFeedbackStats } from '../../domain/policies/feedback/feedback-stats.js';
import type { FeedbackEntry } from '../../domain/policies/feedback/suppression.js';
import { FEEDBACK_PORT } from '../ports/feedback.js';
import type { FeedbackPort } from '../ports/feedback.js';

/** Default lookback window for feedback statistics (days). */
const STATS_LOOKBACK_DAYS = 30;

/**
 * Read model for the feedback data the suppression policy consumes: the active
 * decisions, and the per-rule statistics derived from the recent ones.
 *
 * It loads rows through `FeedbackPort` and computes nothing itself — the
 * aggregation is the domain rule `computeRuleStats`. This is a read model, not
 * a repository: it never writes.
 */
@Injectable()
export class FeedbackReadModel {
  constructor(@Inject(FEEDBACK_PORT) private readonly feedback: FeedbackPort) {}

  /**
   * Loads all active feedback entries for the user, augmented with
   * the original suggestion's ruleId and priorityScore.
   *
   * "Active" means:
   * - accepted: always active (permanent boost, no expiry)
   * - later / not_applicable / suppress: expiresAt is null or in the future
   */
  async loadActive(userId: string, at: Date = now()): Promise<FeedbackEntry[]> {
    const rows = await this.feedback.listActiveFeedback(userId, at);

    return rows.map((row) => ({
      suggestionId: row.suggestionId,
      suggestionType: row.suggestionType as SuggestionType,
      feedback: row.feedback as SuggestionFeedback,
      expiresAt: row.expiresAt,
      ruleId: row.ruleId,
      priorityScore: row.priorityScore,
    }));
  }

  /**
   * Loads feedback statistics for the given rule IDs over the
   * past N days. Returns a map of ruleId → stats.
   */
  async loadStats(
    userId: string,
    ruleIds: string[],
    at: Date = now(),
  ): Promise<Map<string, RuleFeedbackStats>> {
    if (ruleIds.length === 0) {
      return new Map();
    }

    const since = new Date(at.getTime());
    since.setUTCDate(since.getUTCDate() - STATS_LOOKBACK_DAYS);

    const rows = await this.feedback.listFeedbackSince(userId, since);
    return computeRuleStats(rows, ruleIds);
  }
}
