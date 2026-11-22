/**
 * Proposal review for the deepagents runtime.
 *
 * ## Why this is not `interruptOn`
 *
 * deepagents' HITL middleware (`interruptOn`) raises its interrupt **before** a
 * tool executes: it is an approval gate for a call the model already proposed.
 * The assistant's proposal flow needs the opposite ordering — the `*_draft`
 * tool has to *run* to produce the proposal (its id, payload and `expiresAt`
 * are the tool's output), and only then may the thread suspend so the user can
 * confirm.
 *
 * Interrupting before execution would therefore suspend with nothing to apply:
 * the confirm endpoint would have no proposal id to write, which is exactly the
 * "proposal described as an applied write" failure this flow exists to prevent.
 *
 * ## Why this is not `wrapToolCall`
 *
 * A `wrapToolCall`-based interrupt would run the draft tool, suspend, and then
 * **run it again on resume** — LangGraph re-executes the interrupted node from
 * its start, and there is no "already ran" marker to consult. Draft tools are
 * side-effect free today, so a double run would only be wasteful; it becomes a
 * correctness bug the moment a tool writes an audit row. `afterAgent` runs once,
 * after every model and tool call in the invocation, which is the exact point
 * the graph's `write_review` sits at.
 *
 * Ordering therefore mirrors `graph.ts`: tools run → `write_review_setup`
 * persist → `write_review` suspend.
 *
 * ## State
 *
 * `pendingReview` and `proposals` live in middleware state, which the agent's
 * checkpointer persists. That is what the confirm endpoint's `getState` reads.
 * The shapes are the graph's (`AssistantPendingReview`, `AssistantProposedAction`)
 * so the confirm path has one vocabulary, not two.
 */
import { interrupt } from '@langchain/langgraph';
import { createMiddleware } from 'langchain';
import { z } from 'zod';
import type { AssistantProposedAction } from '../../application/ports/assistant.js';

/**
 * The review request handed to whoever reads the suspended thread.
 *
 * Deliberately the same shape `review.ts` uses for the graph path: the client
 * protocol does not depend on which runtime produced the suspension.
 */
export interface DeepAgentReviewRequest {
  proposalIds: string[];
}

/** The decision the client supplies when resuming. */
export interface DeepAgentReviewDecision {
  decision: 'approved' | 'rejected';
  note?: string;
}

/** Persisted review, structurally identical to `AssistantPendingReview`. */
export interface DeepAgentPendingReview {
  proposalIds: string[];
  status: 'pending' | 'approved' | 'rejected';
  decidedAt?: string;
  note?: string;
}

const approvalStateSchema = z.object({
  /**
   * The review the thread is suspended at. Absent on turns that produced no
   * proposal, which is the normal case.
   */
  pendingReview: z.custom<DeepAgentPendingReview | undefined>().optional(),
  /**
   * The proposals the draft tools produced. Kept in state — not only in the
   * runner's return value — because the confirm endpoint re-reads them from the
   * checkpoint after the turn has ended.
   */
  proposals: z.custom<AssistantProposedAction[]>().optional(),
});

/**
 * Builds the middleware that suspends a thread whose turn produced proposals.
 *
 * @param collected - The runner's own tool-result accumulator. Proposals are
 *   read from it rather than parsed back out of a tool message, for the same
 *   reason `deep-agent-runner.ts` wraps `execute`: the envelope is the
 *   caller's data, and the model only ever sees its rendered text.
 */
export function createProposalReviewMiddleware(
  collected: readonly { proposedActions?: AssistantProposedAction[] }[],
) {
  return createMiddleware({
    name: 'AssistantProposalReview',
    stateSchema: approvalStateSchema,
    // Runs once per invocation, after the model/tool loop has finished. On a
    // resumed invocation it re-runs with the client's decision as the
    // interrupt's return value, and writes that decision into state.
    afterAgent: (state) => {
      const existing = (state as { pendingReview?: DeepAgentPendingReview })
        .pendingReview;
      // A resumed invocation already carries a decided review; do not suspend
      // a second time.
      if (existing != null && existing.status !== 'pending') {
        return undefined;
      }

      const proposals = collected.flatMap(
        (entry) => entry.proposedActions ?? [],
      );
      if (proposals.length === 0) return undefined;

      const proposalIds = proposals.map((proposal) => proposal.id);
      // `interrupt` throws the control-flow signal LangGraph turns into a
      // suspension when a checkpointer is present. Everything below runs only
      // on resume.
      const decision = interrupt<
        DeepAgentReviewRequest,
        DeepAgentReviewDecision
      >({ proposalIds });

      return {
        proposals,
        pendingReview: {
          proposalIds,
          status: decision.decision,
          decidedAt: new Date().toISOString(),
          ...(decision.note != null ? { note: decision.note } : {}),
        } satisfies DeepAgentPendingReview,
      };
    },
  });
}
