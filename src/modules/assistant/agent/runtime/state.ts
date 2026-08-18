import { Annotation } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  AssistantContextSource,
  AssistantToolName,
} from '../../tools/shared/tool-types';
import type { AssistantToolExecutionResult } from '../../types/assistant.types';
import type { AssistantIntent } from './classify';

export const ASSISTANT_RUNTIME_NODE_NAMES = [
  'prepare_context',
  'classify_intent',
  'agent',
  'tools',
  'read_subgraph',
  'write_subgraph',
  'knowledge_subgraph',
  'respond',
] as const;

/** Validation flags produced by sub-graph validate nodes. */
export interface AssistantValidationFlags {
  hasEmptyResults: boolean;
  hasPartialCoverage: boolean;
  hasAmbiguities: boolean;
  missingProposedActions: boolean;
}

export const DEFAULT_VALIDATION_FLAGS: AssistantValidationFlags = {
  hasEmptyResults: false,
  hasPartialCoverage: false,
  hasAmbiguities: false,
  missingProposedActions: false,
};

/** Lifecycle of an in-graph proposal review (human-in-the-loop). */
export type AssistantProposalReviewStatus = 'pending' | 'approved' | 'rejected';

/**
 * Persisted review state written before the interrupt node suspends the
 * thread. Expiry is evaluated per proposal (`AssistantProposedAction.expiresAt`)
 * by the confirm endpoint, so no batch-level expiry is stored here (F-11).
 */
export interface AssistantPendingReview {
  proposalIds: string[];
  status: AssistantProposalReviewStatus;
  decidedAt?: string;
  note?: string;
}

export const AssistantRuntimeState = Annotation.Root({
  // ── Input ──────────────────────────────────────────────────────────────
  userId: Annotation<string>,
  userMessage: Annotation<string>,
  locale: Annotation<string>,
  enabledContextSources: Annotation<AssistantContextSource[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  /** Whether cross-conversation memory is enabled for this user. */
  memoryEnabled: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  /** Whether this turn starts a new conversation (≤ 1 user message). */
  isNewConversation: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),

  // ── prepare_context output ─────────────────────────────────────────────
  /** True when prepare_context injected a memory block into messages. */
  memoryInjected: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),

  allowedTools: Annotation<AssistantToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),

  // ── classify_intent output ─────────────────────────────────────────────
  /** Semantic intent of the current user message. */
  intent: Annotation<AssistantIntent | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),

  /** Tools narrowed by the keyword router for the current message. */
  relevantTools: Annotation<AssistantToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),

  /** Which sub-graph is currently active (read/write/knowledge). */
  activeSubGraph: Annotation<AssistantIntent | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),

  /** Validation flags set by sub-graph validate nodes. */
  validationFlags: Annotation<AssistantValidationFlags>({
    reducer: (_left, right) => right,
    default: () => DEFAULT_VALIDATION_FLAGS,
  }),

  /** In-graph proposal review state (HITL); set before interrupt suspends the thread. */
  pendingReview: Annotation<AssistantPendingReview | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
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
  stopReason: Annotation<
    | 'answered'
    | 'no_match'
    | 'tool_cap_reached'
    | 'no_data'
    | 'no_target'
    | 'no_evidence'
    | 'awaiting_review'
    | null
  >({
    reducer: (_left, right) => right,
    default: () => null,
  }),
});

export type AssistantRuntimeState = typeof AssistantRuntimeState.State;
