import { Injectable, Logger } from '@nestjs/common';
import type { SuggestionCandidate } from '../../types';
import { SuggestionFeedback } from '../../types';
import { FeedbackService } from '../feedback/feedback.service';
import type { FeedbackEntry } from '../feedback/feedback.service';
import { FeedbackStatsService } from '../feedback/feedback-stats.service';

/** Result of filtering and adjusting candidates with feedback data. */
export interface SuppressionResult {
  /** Candidates that survived suppression, with adjusted priority scores. */
  candidates: SuggestionCandidate[];
  /** Candidate IDs that were suppressed (for logging/audit). */
  suppressedIds: string[];
}

/**
 * Applies feedback-driven suppression and score adjustments
 * to candidates before they enter the arbitration pipeline.
 *
 * Suppression rules:
 * - suppress: hard filter same-type candidates (unless higher severity)
 * - later: filter same-rule candidates for 4h (unless higher severity)
 * - not_applicable: reduce same-type score by 30% for 7 days (unless higher severity)
 * - accepted: boost same-type score by 10% permanently
 */
@Injectable()
export class SuppressionService {
  private readonly logger = new Logger(SuppressionService.name);

  constructor(
    private readonly feedbackService: FeedbackService,
    private readonly feedbackStatsService: FeedbackStatsService,
  ) {}

  /**
   * Loads active feedbacks for the user, then filters and adjusts
   * the given candidates accordingly.
   */
  async filterAndAdjust(
    userId: string,
    candidates: SuggestionCandidate[],
  ): Promise<SuppressionResult> {
    if (candidates.length === 0) {
      return { candidates: [], suppressedIds: [] };
    }

    const feedbacks = await this.feedbackService.loadActiveFeedbacks(userId);

    // Load feedback-driven score multipliers for each rule
    const ruleIds = [...new Set(candidates.map((c) => c.ruleId))];
    const statsMap = await this.feedbackStatsService.loadStats(userId, ruleIds);

    if (feedbacks.length === 0 && statsMap.size === 0) {
      return { candidates, suppressedIds: [] };
    }

    // Build lookup structures
    const suppressByType = this.buildMaxScoreByType(
      feedbacks,
      SuggestionFeedback.SUPPRESS,
    );
    const laterByRule = this.buildMaxScoreByRule(
      feedbacks,
      SuggestionFeedback.LATER,
    );
    const notApplicableByType = this.buildMaxScoreByType(
      feedbacks,
      SuggestionFeedback.NOT_APPLICABLE,
    );
    const acceptedTypes = this.buildAcceptedTypes(feedbacks);

    const surviving: SuggestionCandidate[] = [];
    const suppressedIds: string[] = [];

    for (const candidate of candidates) {
      // 1. Check hard suppress (by type)
      const suppressThreshold = suppressByType.get(candidate.type);
      if (
        suppressThreshold != null &&
        candidate.priorityScore <= suppressThreshold
      ) {
        suppressedIds.push(candidate.candidateId);
        this.logger.debug(
          `Suppressed candidate ${candidate.candidateId} (type=${candidate.type}, score=${String(candidate.priorityScore)} <= threshold=${String(suppressThreshold)})`,
        );
        continue;
      }

      // 2. Check later delay (by ruleId)
      const laterThreshold = laterByRule.get(candidate.ruleId);
      if (laterThreshold != null && candidate.priorityScore <= laterThreshold) {
        suppressedIds.push(candidate.candidateId);
        this.logger.debug(
          `Delayed candidate ${candidate.candidateId} (rule=${candidate.ruleId}, score=${String(candidate.priorityScore)} <= threshold=${String(laterThreshold)})`,
        );
        continue;
      }

      // 3. Apply score adjustments (clone to avoid mutating original)
      const adjusted = { ...candidate };
      let adjustment = 0;

      // not_applicable: -30% (unless higher severity)
      const naThreshold = notApplicableByType.get(candidate.type);
      if (naThreshold != null && candidate.priorityScore <= naThreshold) {
        adjustment -=
          candidate.priorityScore *
          (FeedbackService.getNotApplicableReductionPercent() / 100);
      }

      // accepted: +10% (permanent)
      if (acceptedTypes.has(candidate.type)) {
        adjustment +=
          candidate.priorityScore *
          (FeedbackService.getAcceptedBoostPercent() / 100);
      }

      // Apply static adjustments first
      if (adjustment !== 0) {
        adjusted.priorityScore = Math.max(
          0,
          Math.round(candidate.priorityScore + adjustment),
        );
      }

      // 4. Apply dynamic feedback-driven score multiplier
      const stats = statsMap.get(candidate.ruleId);
      if (stats != null && stats.scoreMultiplier !== 1.0) {
        adjusted.priorityScore = Math.max(
          0,
          Math.round(adjusted.priorityScore * stats.scoreMultiplier),
        );
        this.logger.debug(
          `Applied dynamic multiplier ${String(stats.scoreMultiplier)} to candidate ${candidate.candidateId} (rule=${candidate.ruleId}, acceptRatio=${String(stats.acceptRatio)}, suppressRatio=${String(stats.suppressRatio)})`,
        );
      }

      surviving.push(adjusted);
    }

    return { candidates: surviving, suppressedIds };
  }

  /**
   * Builds a map of suggestionType → max priorityScore among active
   * feedbacks of the given type.
   */
  private buildMaxScoreByType(
    feedbacks: FeedbackEntry[],
    feedbackType: SuggestionFeedback,
  ): Map<string, number> {
    const result = new Map<string, number>();
    for (const entry of feedbacks) {
      if (entry.feedback !== feedbackType) continue;
      const current = result.get(entry.suggestionType);
      if (current == null || entry.priorityScore > current) {
        result.set(entry.suggestionType, entry.priorityScore);
      }
    }
    return result;
  }

  /**
   * Builds a map of ruleId → max priorityScore among active
   * feedbacks of the given type.
   */
  private buildMaxScoreByRule(
    feedbacks: FeedbackEntry[],
    feedbackType: SuggestionFeedback,
  ): Map<string, number> {
    const result = new Map<string, number>();
    for (const entry of feedbacks) {
      if (entry.feedback !== feedbackType) continue;
      const current = result.get(entry.ruleId);
      if (current == null || entry.priorityScore > current) {
        result.set(entry.ruleId, entry.priorityScore);
      }
    }
    return result;
  }

  /**
   * Builds a set of types that have at least one "accepted" feedback.
   */
  private buildAcceptedTypes(feedbacks: FeedbackEntry[]): Set<string> {
    const result = new Set<string>();
    for (const entry of feedbacks) {
      if (entry.feedback === SuggestionFeedback.ACCEPTED) {
        result.add(entry.suggestionType);
      }
    }
    return result;
  }
}
