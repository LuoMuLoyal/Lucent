import { END, START, StateGraph } from '@langchain/langgraph';
import { MAX_TOOL_LOOPS } from '../../tools/constants';
import { AssistantRuntimeState } from './state';
import {
  selectAllowedToolsForContextSources,
  selectRelevantToolsForMessage,
} from './router';

export { AssistantRuntimeState, ASSISTANT_RUNTIME_NODE_NAMES } from './state';
export {
  selectAllowedToolsForContextSources,
  selectRelevantToolsForMessage,
} from './router';

export function buildAssistantRuntimeGraph() {
  return new StateGraph(AssistantRuntimeState)
    .addNode('prepare_context', (state) => ({
      allowedTools: selectAllowedToolsForContextSources(
        state.enabledContextSources,
      ),
      selectedTools: selectRelevantToolsForMessage(
        state.userMessage,
        selectAllowedToolsForContextSources(state.enabledContextSources),
      ),
      loopCount: Math.min(MAX_TOOL_LOOPS, 1),
      retrievalEvidence: selectRelevantToolsForMessage(
        state.userMessage,
        selectAllowedToolsForContextSources(state.enabledContextSources),
      ),
      stopReason:
        selectRelevantToolsForMessage(
          state.userMessage,
          selectAllowedToolsForContextSources(state.enabledContextSources),
        ).length === 0
          ? 'no_match'
          : 'answered',
      route: 'respond' as const,
    }))
    .addNode('respond', () => ({}))
    .addEdge(START, 'prepare_context')
    .addEdge('prepare_context', 'respond')
    .addEdge('respond', END)
    .compile();
}
