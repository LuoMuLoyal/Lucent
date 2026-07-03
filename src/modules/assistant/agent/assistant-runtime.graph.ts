import { END, START, StateGraph } from '@langchain/langgraph';
import { MAX_TOOL_LOOPS } from '../tools/assistant-tool.constants';
import { AssistantRuntimeState } from './assistant-runtime.state';
import {
  selectAllowedToolsForContextSources,
  selectRelevantToolsForMessage,
} from './assistant-runtime.router';

export {
  AssistantRuntimeState,
  ASSISTANT_RUNTIME_NODE_NAMES,
} from './assistant-runtime.state';
export {
  selectAllowedToolsForContextSources,
  selectRelevantToolsForMessage,
} from './assistant-runtime.router';

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
