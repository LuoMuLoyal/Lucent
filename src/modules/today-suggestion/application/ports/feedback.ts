/**
 * Persistence port for the feedback side of Daily Guidance
 * (`application/ports`, per ADR-0024).
 *
 * ## Why one method writes two tables
 *
 * `recordDecision` writes the feedback row **and** advances the suggestion's
 * `lifecycleState` in one transaction. That is not cross-aggregate leakage to
 * be "fixed" later — it is the correct shape:
 *
 * a user tapping "not needed" means one thing, *"I reject this card and it
 * should go away"*. Splitting it into two transactions could leave either the
 * rejection recorded with the card still showing, or the card gone with no
 * record of why — and the user cannot correct either, because they already
 * tapped. The feedback row is the **fate of that card**, so it belongs with the
 * card's state transition.
 *
 * Naming the method `recordDecision` (rather than something like
 * `recordFeedbackAtomic`) keeps that intent visible: this is not a workaround,
 * it is the decision being persisted in its two forms.
 */

import type {
  SuggestionFeedback,
  SuggestionType,
} from '../../domain/suggestion/suggestion.types.js';

/** DI token; the port interface itself lives below. */
export const FEEDBACK_PORT = 'FEEDBACK_PORT';

/** The suggestion a decision is recorded against. */
export interface DecidableSuggestion {
  id: string;
  type: SuggestionType;
  ruleId: string;
  priorityScore: number;
  lifecycleState: string;
}

/** What the user decided, and the two derived facts the caller needs back. */
export interface SuggestionDecision {
  userId: string;
  suggestionId: string;
  feedback: SuggestionFeedback;
  suggestionType: SuggestionType;
  /** When the decision was made; stamped on the suggestion row. */
  at: Date;
  /** When this decision stops affecting scoring; `null` = permanent. */
  expiresAt: Date | null;
  /**
   * Whether to also advance the card to `dismissed`.
   * `later` and `suppress` dismiss the card; `accepted` and `not_applicable`
   * leave it visible.
   */
  dismiss: boolean;
}

/** One active feedback row, joined with the suggestion it refers to. */
export interface ActiveFeedbackRow {
  suggestionId: string;
  suggestionType: string;
  feedback: string;
  appliedAt: Date;
  expiresAt: Date | null;
  ruleId: string;
  priorityScore: number;
}

/** One feedback row inside the statistics lookback window. */
export interface RecentFeedbackRow {
  suggestionId: string;
  feedback: string;
  appliedAt: Date;
}

/** A feedback row plus the rule it belongs to (resolved via its suggestion). */
export interface FeedbackRuleRow extends RecentFeedbackRow {
  ruleId: string;
}

export interface FeedbackPort {
  /** The suggestion, scoped to its owner; `null` when it does not exist. */
  findSuggestion(
    userId: string,
    suggestionId: string,
  ): Promise<DecidableSuggestion | null>;

  /** Persists the decision in both of its forms, atomically. */
  recordDecision(decision: SuggestionDecision): Promise<void>;

  /**
   * Feedback rows still affecting scoring: `accepted` forever, the rest until
   * their `expiresAt`, joined with each suggestion's `ruleId` / `priorityScore`.
   */
  listActiveFeedback(userId: string, at: Date): Promise<ActiveFeedbackRow[]>;

  /**
   * Feedback rows recorded since `since`, joined with the `ruleId` of the
   * suggestion they refer to. Rows whose suggestion no longer exists are
   * dropped.
   */
  listFeedbackSince(userId: string, since: Date): Promise<FeedbackRuleRow[]>;
}
