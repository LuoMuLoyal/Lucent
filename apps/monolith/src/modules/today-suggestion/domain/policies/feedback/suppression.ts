import type { Logger } from '@nestjs/common';
import type { SuggestionCandidate } from '../../suggestion/suggestion-candidate.js';
import { SuggestionFeedback } from '../../suggestion/suggestion.types.js';
import type { SuggestionType } from '../../suggestion/suggestion.types.js';
import type { RuleFeedbackStats } from './feedback-stats.js';

/** Score boost applied to a type with an `accepted` feedback (fraction). */
const ACCEPTED_BOOST = 0.1;

/** Score reduction applied to a type with a `not_applicable` feedback (fraction). */
const NOT_APPLICABLE_REDUCTION = 0.3;

/**
 * A single active feedback entry augmented with the original
 * suggestion's ruleId and priorityScore (for severity-escalation checks).
 */
export interface FeedbackEntry {
  suggestionId: string;
  suggestionType: SuggestionType;
  feedback: SuggestionFeedback;
  expiresAt: Date | null;
  ruleId: string;
  priorityScore: number;
}

/** Result of filtering and adjusting candidates with feedback data. */
export interface SuppressionResult {
  /** Candidates that survived suppression, with adjusted priority scores. */
  candidates: SuggestionCandidate[];
  /** Candidate IDs that were suppressed (for logging/audit). */
  suppressedIds: string[];
}

/** Inputs the suppression policy needs, already loaded by the caller. */
export interface SuppressionInputs {
  feedbacks: FeedbackEntry[];
  stats: Map<string, RuleFeedbackStats>;
}

/**
 * Applies feedback-driven suppression and score adjustments to candidates
 * before they enter the arbitration pipeline.
 *
 * Pure — the active feedbacks and per-rule statistics are loaded by the
 * caller (the pipeline service) and passed in; nothing here touches IO.
 *
 * Suppression rules:
 * - suppress: hard filter same-type candidates (unless higher severity)
 * - later: filter same-rule candidates for 4h (unless higher severity)
 * - not_applicable: reduce same-type score by 30% for 7 days (unless higher severity)
 * - accepted: boost same-type score by 10% permanently
 */
export function suppressAndAdjust(
  candidates: SuggestionCandidate[],
  { feedbacks, stats }: SuppressionInputs,
  logger?: Logger,
): SuppressionResult {
  if (candidates.length === 0) {
    return { candidates: [], suppressedIds: [] };
  }

  if (feedbacks.length === 0 && stats.size === 0) {
    return { candidates, suppressedIds: [] };
  }

  // Build lookup structures
  const suppressByType = buildMaxScoreByType(
    feedbacks,
    SuggestionFeedback.SUPPRESS,
  );
  const laterByRule = buildMaxScoreByRule(feedbacks, SuggestionFeedback.LATER);
  const notApplicableByType = buildMaxScoreByType(
    feedbacks,
    SuggestionFeedback.NOT_APPLICABLE,
  );
  const acceptedTypes = buildAcceptedTypes(feedbacks);

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
      logger?.debug(
        `Suppressed candidate ${candidate.candidateId} (type=${candidate.type}, score=${String(candidate.priorityScore)} <= threshold=${String(suppressThreshold)})`,
      );
      continue;
    }

    // 2. Check later delay (by ruleId)
    const laterThreshold = laterByRule.get(candidate.ruleId);
    if (laterThreshold != null && candidate.priorityScore <= laterThreshold) {
      suppressedIds.push(candidate.candidateId);
      logger?.debug(
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
      adjustment -= candidate.priorityScore * NOT_APPLICABLE_REDUCTION;
    }

    // accepted: +10% (permanent)
    if (acceptedTypes.has(candidate.type)) {
      adjustment += candidate.priorityScore * ACCEPTED_BOOST;
    }

    // Apply static adjustments first
    if (adjustment !== 0) {
      adjusted.priorityScore = Math.max(
        0,
        Math.round(candidate.priorityScore + adjustment),
      );
    }

    // 4. Apply dynamic feedback-driven score multiplier
    const ruleStats = stats.get(candidate.ruleId);
    if (ruleStats != null && ruleStats.scoreMultiplier !== 1.0) {
      adjusted.priorityScore = Math.max(
        0,
        Math.round(adjusted.priorityScore * ruleStats.scoreMultiplier),
      );
      logger?.debug(
        `Applied dynamic multiplier ${String(ruleStats.scoreMultiplier)} to candidate ${candidate.candidateId} (rule=${candidate.ruleId}, acceptRatio=${String(ruleStats.acceptRatio)}, suppressRatio=${String(ruleStats.suppressRatio)})`,
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
function buildMaxScoreByType(
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
function buildMaxScoreByRule(
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
function buildAcceptedTypes(feedbacks: FeedbackEntry[]): Set<string> {
  const result = new Set<string>();
  for (const entry of feedbacks) {
    if (entry.feedback === SuggestionFeedback.ACCEPTED) {
      result.add(entry.suggestionType);
    }
  }
  return result;
}
