import { SystemMessage } from '@langchain/core/messages';
import { interrupt } from '@langchain/langgraph';
import type { AssistantToolExecutionResult } from '../../types/assistant.types';
import type { AssistantPendingReview, AssistantRuntimeState } from './state';

/** Payload exposed to the suspended thread's caller via getState/interrupt. */
export interface AssistantReviewRequest {
  proposalIds: string[];
  expiresAt?: string;
}

/** Decision supplied by the client when resuming the thread. */
export interface AssistantReviewDecision {
  decision: 'approved' | 'rejected';
  note?: string;
}

/**
 * Extracts proposal metadata from accumulated tool results.
 * Returns null when no proposal is pending confirmation.
 */
export function collectProposalReview(
  toolResults: readonly AssistantToolExecutionResult[],
): AssistantReviewRequest | null {
  const proposalIds = toolResults.flatMap(
    (result) => result.proposedActions?.map((action) => action.id) ?? [],
  );
  if (proposalIds.length === 0) return null;
  const expiresAt = toolResults
    .flatMap((result) => result.proposedActions ?? [])
    .map((action) => action.expiresAt)
    .sort()[0];
  if (expiresAt == null) return { proposalIds };
  return { proposalIds, expiresAt };
}

/**
 * Node 1: persists the pending review state before the thread suspends, so
 * callers can read it via `graph.getState` (used by the confirm endpoint).
 */
export function createWriteReviewSetupNode() {
  return (state: AssistantRuntimeState) => {
    const review = collectProposalReview(state.toolResults);
    if (review == null) {
      return { stopReason: 'no_target' as const };
    }
    return {
      pendingReview: { ...review, status: 'pending' as const },
      stopReason: 'awaiting_review' as const,
    };
  };
}

/**
 * Node 2: suspends the thread via `interrupt` and waits for the client's
 * decision. On resume the decision is written back to `pendingReview` and a
 * guidance message is appended so the reply never repeats sensitive details
 * (the approved writes were already applied server-side by the confirm
 * endpoint before the thread resumed).
 */
export function createWriteReviewNode() {
  return (state: AssistantRuntimeState) => {
    const pending = state.pendingReview;
    const review: AssistantReviewRequest =
      pending != null
        ? {
            proposalIds: pending.proposalIds,
            ...(pending.expiresAt != null
              ? { expiresAt: pending.expiresAt }
              : {}),
          }
        : (collectProposalReview(state.toolResults) ?? { proposalIds: [] });
    const decision = interrupt<AssistantReviewRequest, AssistantReviewDecision>(
      review,
    );
    const proposalIds = pending?.proposalIds ?? review.proposalIds;
    const expiresAt = pending?.expiresAt ?? review.expiresAt;
    const pendingReview: AssistantPendingReview = {
      proposalIds,
      ...(expiresAt != null ? { expiresAt } : {}),
      status: decision.decision,
      decidedAt: new Date().toISOString(),
      ...(decision.note != null ? { note: decision.note } : {}),
    };
    return {
      pendingReview,
      messages: [
        new SystemMessage(
          decision.decision === 'approved'
            ? 'The user approved the proposal and the writes were applied server-side. Acknowledge completion without repeating sensitive details.'
            : 'The user rejected the proposal. Do not perform or imply any write.',
        ),
      ],
    };
  };
}
