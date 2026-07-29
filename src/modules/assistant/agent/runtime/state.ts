import { Annotation } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  AssistantContextSource,
  AssistantToolName,
} from '../../tools/tool-types';
import type { AssistantToolExecutionResult } from '../../types/assistant.types';

export const ASSISTANT_RUNTIME_NODE_NAMES = [
  'prepare_context',
  'agent',
  'tools',
  'respond',
] as const;

export const AssistantRuntimeState = Annotation.Root({
  // ── Input ──────────────────────────────────────────────────────────────
  userId: Annotation<string>,
  userMessage: Annotation<string>,
  locale: Annotation<string>,
  enabledContextSources: Annotation<AssistantContextSource[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),

  // ── prepare_context output ─────────────────────────────────────────────
  allowedTools: Annotation<AssistantToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),

  // ── LLM conversation messages ──────────────────────────────────────────
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),

  // ── Tool-loop state ────────────────────────────────────────────────────
  /** Tools selected by the LLM in the most recent agent call. */
  pendingToolCalls: Annotation<AssistantToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),

  /** Accumulated tool execution results across all iterations. */
  toolResults: Annotation<AssistantToolExecutionResult[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),

  loopCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),

  /** LLM's text response when no more tools are needed. */
  finalContent: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),

  /** Tools selected by the LLM across all iterations. */
  selectedTools: Annotation<AssistantToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),

  /** Why the agent loop terminated. */
  stopReason: Annotation<'answered' | 'no_match' | 'tool_cap_reached' | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
});

export type AssistantRuntimeState = typeof AssistantRuntimeState.State;
