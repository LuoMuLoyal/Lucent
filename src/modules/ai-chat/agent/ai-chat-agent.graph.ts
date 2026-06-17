import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  AI_CHAT_TOOL_SOURCE_MAP,
  type AiChatContextSource,
  type AiChatToolName,
} from '../tools/ai-chat-tool.types';

const AI_CHAT_ROUTE = 'respond' as const;

export const AI_CHAT_FOUNDATION_NODE_NAMES = [
  'prepare_context',
  AI_CHAT_ROUTE,
] as const;

const AiChatFoundationState = Annotation.Root({
  userId: Annotation<string>,
  userMessage: Annotation<string>,
  locale: Annotation<string>,
  enabledContextSources: Annotation<AiChatContextSource[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  allowedTools: Annotation<AiChatToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  route: Annotation<'respond'>({
    reducer: (_left, right) => right,
    default: () => AI_CHAT_ROUTE,
  }),
});

export type AiChatFoundationState = typeof AiChatFoundationState.State;

export function selectAllowedToolsForContextSources(
  enabledContextSources: readonly AiChatContextSource[],
): AiChatToolName[] {
  const enabled = new Set(enabledContextSources);

  return Object.entries(AI_CHAT_TOOL_SOURCE_MAP)
    .filter(([, requiredSources]) =>
      requiredSources.every((source) => enabled.has(source)),
    )
    .map(([toolName]) => toolName as AiChatToolName);
}

export function buildAiChatFoundationGraph() {
  return new StateGraph(AiChatFoundationState)
    .addNode('prepare_context', (state) => ({
      allowedTools: selectAllowedToolsForContextSources(
        state.enabledContextSources,
      ),
      route: AI_CHAT_ROUTE,
    }))
    .addNode('respond', () => ({}))
    .addEdge(START, 'prepare_context')
    .addEdge('prepare_context', 'respond')
    .addEdge('respond', END)
    .compile();
}
