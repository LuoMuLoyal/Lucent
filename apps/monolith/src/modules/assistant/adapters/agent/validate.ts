import { SystemMessage } from '@langchain/core/messages';
import type { AssistantToolExecutionResult } from '../../application/ports/assistant.js';
import type {
  AssistantRuntimeState,
  AssistantValidationFlags,
} from './state.js';
import { DEFAULT_VALIDATION_FLAGS } from './state.js';
import type { AssistantPendingReview } from './state.js';

/**
 * Validates tool results against the server-owned envelope and derives the
 * turn's stop reason.
 *
 * Inspects each result's `data.coverage.status` ('complete' | 'partial' |
 * 'empty') and `data.ambiguities`, producing a compact
 * {@link AssistantValidationFlags}. Non-envelope results are skipped.
 */
export function validateReadResults(
  toolResults: readonly AssistantToolExecutionResult[],
): AssistantValidationFlags {
  const flags: AssistantValidationFlags = { ...DEFAULT_VALIDATION_FLAGS };

  for (const result of toolResults) {
    const data = result.data;

    const coverage = data['coverage'];
    if (coverage != null && typeof coverage === 'object') {
      const status = (coverage as { status?: unknown }).status;
      if (status === 'empty') {
        flags.hasEmptyResults = true;
      } else if (status === 'partial') {
        flags.hasPartialCoverage = true;
      }
    }

    const ambiguities = data['ambiguities'];
    if (Array.isArray(ambiguities) && ambiguities.length > 0) {
      flags.hasAmbiguities = true;
    }
  }

  return flags;
}

/** Proposal ids produced by this turn's write tools, in result order. */
function collectProposalIds(
  toolResults: readonly AssistantToolExecutionResult[],
): string[] {
  return toolResults.flatMap(
    (result) => result.proposedActions?.map((action) => action.id) ?? [],
  );
}

/**
 * Builds the single validation node that replaced the three sub-graph
 * `*_validate` nodes.
 *
 * It answers one question: given the tool results, what must the reply be told
 * so it does not overstate what it knows? Three cases, each with its own
 * guidance message and stop reason:
 *
 * - **No evidence** (every read returned empty coverage): say the evidence was
 *   not found. `stopReason: 'no_evidence'`.
 * - **Partial coverage**: distinguish what the source says from inference.
 * - **No proposal produced** while write tools ran: treat that as a refusal to
 *   guess the target. `stopReason: 'no_target'`.
 *
 * Proposal detection is also exposed here so the graph can decide HITL: a turn
 * that produced proposals sets `pendingReview`, which is what the review nodes
 * suspend on.
 *
 * The node only ever appends guidance as a `SystemMessage`; it never rewrites
 * earlier messages (`messages` is an append reducer).
 */
export function createValidateNode(options: {
  /**
   * Whether anything will actually suspend on a proposal.
   *
   * Without a checkpointer there is no thread to park, so the node must not
   * announce a review: a `pendingReview` that nothing suspends on is a lie the
   * caller would read as "a confirmation is waiting for you".
   */
  supportsReview: boolean;
}) {
  return (state: AssistantRuntimeState) => {
    const validationFlags = validateReadResults(state.toolResults);
    const proposalIds = collectProposalIds(state.toolResults);
    const messages = [...state.messages];

    if (validationFlags.hasEmptyResults) {
      messages.push(
        new SystemMessage(
          'All retrieval tools returned no evidence. Say the evidence was not found instead of guessing.',
        ),
      );
    }
    if (validationFlags.hasPartialCoverage) {
      messages.push(
        new SystemMessage(
          'Coverage is partial. Distinguish what the source explicitly says from your own inference.',
        ),
      );
    }

    // A write tool ran but produced no draft: the target could not be located.
    const wroteButNothingProposed =
      proposalIds.length === 0 && state.selectedTools.length > 0
        ? state.selectedTools.some((tool) => tool.startsWith('propose_'))
        : false;
    if (wroteButNothingProposed) {
      messages.push(
        new SystemMessage(
          'No write proposal was produced. Tell the user the target could not be located instead of improvising one.',
        ),
      );
    }

    return {
      validationFlags: {
        ...validationFlags,
        missingProposedActions: wroteButNothingProposed,
      },
      messages,
      // Proposal presence is what the graph's HITL branch keys on. Writing it
      // here (rather than in a separate setup node) keeps "did this turn produce
      // a draft" answered exactly once, from the tool results themselves.
      ...(options.supportsReview && proposalIds.length > 0
        ? {
            pendingReview: {
              proposalIds,
              status: 'pending' as const,
            } satisfies AssistantPendingReview,
          }
        : {}),
      stopReason: resolveStopReason(state, {
        hasEmptyResults: validationFlags.hasEmptyResults,
        wroteButNothingProposed,
      }),
    };
  };
}

/**
 * Why the turn stopped, as the state union spells it.
 *
 * Named here rather than inlined so the priority order is one readable list.
 */
type StopReason =
  'answered' | 'tool_cap_reached' | 'no_target' | 'no_evidence' | null;

/**
 * Picks the stop reason, in priority order.
 *
 * `tool_cap_reached` outranks everything: when the loop ran out with calls still
 * pending, the reply must say so regardless of what the results looked like —
 * otherwise a truncated investigation reads as a complete answer.
 *
 * A turn that already produced text stays `answered`: the validation flags
 * describe evidence quality, they do not retract an answer the model wrote.
 * `no_evidence` therefore only applies when the turn ended without content, so
 * `respond` still has to say something about the gap.
 */
function resolveStopReason(
  state: AssistantRuntimeState,
  outcome: {
    hasEmptyResults: boolean;
    wroteButNothingProposed: boolean;
  },
): StopReason {
  // `loopCapped` rather than `pendingToolCalls`: `tools` clears the pending list
  // on every iteration, so by now it is empty either way.
  if (state.loopCapped) {
    return 'tool_cap_reached';
  }
  if (outcome.wroteButNothingProposed) {
    return 'no_target';
  }
  if (state.finalContent != null) {
    return 'answered';
  }
  if (outcome.hasEmptyResults) {
    return 'no_evidence';
  }
  return null;
}
