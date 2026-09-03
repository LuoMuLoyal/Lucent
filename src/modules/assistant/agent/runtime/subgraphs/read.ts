import { END, START, StateGraph } from '@langchain/langgraph';
import { SystemMessage } from '@langchain/core/messages';
import { MAX_TOOL_LOOPS } from '../../../tools/shared/tool-constants.js';
import { AssistantRuntimeState } from '../state.js';
import { createAgentNode, createToolsNode } from '../nodes.js';
import { validateReadResults } from '../validate.js';
import type { AssistantGraphDeps } from '../graph.js';

/**
 * Builds the read-data sub-graph.
 *
 * ```
 * START → read_agent ↔ read_tools → read_validate → END
 * ```
 *
 * - `read_agent` binds the narrowed `relevantTools` (all user-data reads) and
 *   calls the LLM with the read system prompt.
 * - `read_tools` executes pending tool calls.
 * - `read_validate` inspects envelope `coverage.status`. Partial/empty results
 *   append a guidance message so the final reply acknowledges the gap — it
 *   never loops back for another LLM round (loops are driven only by pending
 *   tool calls, see review revision R3).
 */
export function buildReadSubGraph(
  deps: Pick<AssistantGraphDeps, 'createModel' | 'executeTools' | 'onText'>,
) {
  return new StateGraph(AssistantRuntimeState)
    .addNode('read_agent', createAgentNode(deps))
    .addNode('read_tools', createToolsNode(deps))
    .addNode('read_validate', (state) => {
      const validationFlags = validateReadResults(state.toolResults);
      const messages = [...state.messages];

      if (validationFlags.hasPartialCoverage) {
        messages.push(
          new SystemMessage(
            'Read coverage is partial. Acknowledge the limited data instead of smoothing it over.',
          ),
        );
      }
      if (validationFlags.hasEmptyResults) {
        messages.push(
          new SystemMessage(
            'All read tools returned empty coverage. Tell the user no matching data was found.',
          ),
        );
      }

      return {
        validationFlags,
        messages,
        stopReason: validationFlags.hasEmptyResults
          ? ('no_data' as const)
          : state.stopReason,
      };
    })
    .addEdge(START, 'read_agent')
    .addConditionalEdges('read_agent', (state) => {
      if (
        state.pendingToolCalls.length > 0 &&
        state.loopCount < MAX_TOOL_LOOPS
      ) {
        return 'read_tools';
      }
      return 'read_validate';
    })
    .addEdge('read_tools', 'read_agent')
    .addEdge('read_validate', END)
    .compile();
}
