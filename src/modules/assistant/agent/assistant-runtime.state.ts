import { Annotation } from '@langchain/langgraph';
import type {
  AssistantContextSource,
  AssistantToolName,
} from '../tools/assistant-tool.types';

const ASSISTANT_ROUTE = 'respond' as const;

export const ASSISTANT_RUNTIME_NODE_NAMES = [
  'prepare_context',
  ASSISTANT_ROUTE,
] as const;

export const AssistantRuntimeState = Annotation.Root({
  userId: Annotation<string>,
  userMessage: Annotation<string>,
  locale: Annotation<string>,
  enabledContextSources: Annotation<AssistantContextSource[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  allowedTools: Annotation<AssistantToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  selectedTools: Annotation<AssistantToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  loopCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  retrievalEvidence: Annotation<AssistantToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  stopReason: Annotation<'answered' | 'no_match' | 'tool_cap_reached' | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  route: Annotation<'respond'>({
    reducer: (_left, right) => right,
    default: () => ASSISTANT_ROUTE,
  }),
});

export type AssistantRuntimeState = typeof AssistantRuntimeState.State;
