/**
 * Outbound port for the suspended review state (ADR-0024 §4).
 *
 * `Proposal` is the only aggregate in the assistant context whose **state lives
 * outside the database**: a proposal exists in the graph's checkpoint between the
 * review step and the confirm call, and nowhere else. The domain therefore needs a
 * port that loads the review of a conversation and applies a decision to it — but
 * it must not know that the store is a LangGraph checkpointer, which is why this
 * interface is declared here and implemented in `adapters/agent/` (the place that
 * already talks to LangGraph).
 *
 * Layer purity: only `domain/` types (ADR-0024 rule D1).
 */

import type { ProposalDecision, ProposalReview } from './proposal.js';

/** DI token — string so a Nest resolution error names the port readably. */
export const ASSISTANT_PROPOSAL_REVIEWS = 'ASSISTANT_PROPOSAL_REVIEWS';

export interface ProposalReviewStore {
  /**
   * The review the conversation is currently suspended at, or `null` when the
   * thread is not suspended (already resumed, never suspended, or gone).
   */
  load(conversationId: string): Promise<ProposalReview | null>;

  /**
   * Releases the suspended thread with the user's decision.
   *
   * Returns the confirmation reply the graph produced; `null` when the graph had
   * no final content to report.
   */
  resume(input: {
    conversationId: string;
    decision: ProposalDecision;
    note?: string;
  }): Promise<{ finalContent: string | null }>;
}
