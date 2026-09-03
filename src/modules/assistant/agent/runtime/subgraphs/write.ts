import { END, START, StateGraph } from '@langchain/langgraph';
import { SystemMessage } from '@langchain/core/messages';
import { MAX_TOOL_LOOPS } from '../../../tools/shared/tool-constants.js';
import { AssistantRuntimeState, DEFAULT_VALIDATION_FLAGS } from '../state.js';
import { createAgentNode, createToolsNode } from '../nodes.js';
import type { AssistantGraphDeps } from '../graph.js';

/**
 * Builds the write-proposal sub-graph.
 *
 * ```
 * START → write_agent ↔ write_tools → write_validate → END
 * ```
 *
 * - `write_agent` binds the narrowed `propose_*` tools and calls the LLM with
 *   the write system prompt (proposal-only semantics).
 * - `write_tools` executes pending proposal tools.
 * - `write_validate` checks whether any `proposedActions` were produced. When
 *   none were, it sets `stopReason: 'no_target'` and appends a guidance
 *   message so the reply treats the missing target as a refusal to guess.
 */
export function buildWriteSubGraph(
  deps: Pick<AssistantGraphDeps, 'createModel' | 'executeTools' | 'onText'>,
) {
  return new StateGraph(AssistantRuntimeState)
    .addNode('write_agent', createAgentNode(deps))
    .addNode('write_tools', createToolsNode(deps))
    .addNode('write_validate', (state) => {
      const hasProposals = state.toolResults.some(
        (result) =>
          result.proposedActions != null && result.proposedActions.length > 0,
      );

      const messages = [...state.messages];
      if (!hasProposals) {
        messages.push(
          new SystemMessage(
            'No write proposal was produced. Tell the user the target could not be located instead of improvising one.',
          ),
        );
      }

      return {
        validationFlags: {
          ...DEFAULT_VALIDATION_FLAGS,
          missingProposedActions: !hasProposals,
        },
        messages,
        stopReason: hasProposals ? state.stopReason : ('no_target' as const),
      };
    })
    .addEdge(START, 'write_agent')
    .addConditionalEdges('write_agent', (state) => {
      if (
        state.pendingToolCalls.length > 0 &&
        state.loopCount < MAX_TOOL_LOOPS
      ) {
        return 'write_tools';
      }
      return 'write_validate';
    })
    .addEdge('write_tools', 'write_agent')
    .addEdge('write_validate', END)
    .compile();
}
