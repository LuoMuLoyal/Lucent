import { Annotation } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  AssistantContextSource,
  AssistantToolName,
} from '../../tools/shared/tool-types.js';
import type { AssistantToolExecutionResult } from '../../types/assistant.types.js';
import type { AssistantToolCall } from '../../types/assistant.types.js';
import type { AssistantIntent } from './classify.js';

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
  /**
   * 跨会话记忆块（`prepare_context` 取到、`classify_intent` 拼进消息）。
   *
   * 记忆块的取用是异步的、且只在"新会话且开启记忆"时才做，但消息列表必须等
   * 意图选定（system prompt 随意图变）之后才能一次性写出来 —— 见 `messages` 通道
   * 的说明。所以两步之间用这个通道传递文本，而不是先写消息再改写。
   */
  memoryBlock: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => '',
  }),

  /** True when prepare_context obtained a memory block for this turn. */
  memoryInjected: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),

  /**
   * 本轮**允许**绑定的工具集（候选集/硬上限）。
   *
   * 由调用方在进入图之前算好：用户 context 开关 ∩ 已实现 ∩ sidecar 可用
   * （`policy.service.ts` 的 `toolCapabilities[].enabled`）。模型选出的工具必须与它求交，
   * 降级（模型不可用）时也**只能**开到它为止。
   */
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

  /** 模型为本轮选出的工具（与 `allowedTools` 求交后的结果）。 */
  relevantTools: Annotation<AssistantToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),

  /** 本轮路由来源：`llm` 正常，`degraded_all_tools` 表示降级为全开。 */
  routingSource: Annotation<'llm' | 'degraded_all_tools'>({
    reducer: (_left, right) => right,
    default: () => 'llm',
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
  /**
   * ⚠️ **append reducer**：谁写谁往后接，不能用来"改写首条 System"。
   *
   * 旧实现让 `prepare_context` 先写 `[System, (memory), Human]`、再让
   * `classify_intent` 写 `[System', ...state.messages.slice(1)]` 想替换首条 —— 实际是又
   * 追加了一遍，同一轮出现两条 System、两条用户消息（2026-10-07 定位，见计划 C7）。
   * 现在的分工是：`prepare_context` 只准备记忆块，`classify_intent` 选定提示词后
   * **一次性**写出完整消息列表。
   */
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),

  // ── Tool-loop state ────────────────────────────────────────────────────
  /**
   * Tool calls selected by the LLM in the most recent agent call, including
   * the arguments it produced (consumed by the tools node / execution layer).
   */
  pendingToolCalls: Annotation<AssistantToolCall[]>({
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
