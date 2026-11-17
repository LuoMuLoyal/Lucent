import { Annotation } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  ContextSource,
  ToolName,
} from '../../domain/policies/tool-permission.js';
import type { AssistantToolExecutionResult } from '../../application/ports/assistant.js';
import type { AssistantToolCall } from '../../application/ports/assistant.js';

export const ASSISTANT_RUNTIME_NODE_NAMES = [
  'prepare_context',
  'agent',
  'tools',
  'respond',
] as const;

/** Validation flags produced by sub-graph validate nodes. */
export interface AssistantValidationFlags {
  hasEmptyResults: boolean;
  hasPartialCoverage: boolean;
  hasAmbiguities: boolean;
  missingProposedActions: boolean;
}

/**
 * One prior turn of the conversation.
 *
 * Kept as plain data rather than `BaseMessage`: the graph does not interpret it,
 * it only forwards it (today: nowhere — the agent node reads `messages`, which
 * the checkpointer populates). It stays on the state so a resumed or stateless
 * turn can still be inspected without reaching into framework objects.
 */
export interface AssistantConversationTurn {
  role: 'user' | 'assistant';
  content: string;
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
  enabledContextSources: Annotation<ContextSource[]>({
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

  /**
   * Prior turns of this conversation, oldest first, **excluding** the current
   * message.
   *
   * Carried for context inspection. The routing that once depended on it is
   * gone: `agent` now binds every candidate tool, so no per-turn selection has
   * to be justified against the conversation.
   *
   * Taken from the request (`dto.messages`), not the checkpoint: the graph also
   * runs stateless (no `conversationId`), where there is no checkpoint to read.
   */
  conversationHistory: Annotation<AssistantConversationTurn[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),

  // ── prepare_context output ─────────────────────────────────────────────
  /**
   * 跨会话记忆块（`prepare_context` 取到、`agent` 拼进消息）。
   *
   * 记忆块的取用是异步的、且只在"新会话且开启记忆"时才做，而 prompt 必须
   * 一次性写出来（`messages` 是 append reducer，先写再改会追加出第二份）。
   * 所以两步之间用这个通道传递文本，而不是先写消息再改写。
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
   * （`policy.service.ts` 的 `toolCapabilities[].enabled`）。`agent` 绑定它**全量**，
   * 模型自己决定调什么、调几次。
   */
  allowedTools: Annotation<ToolName[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),

  /** Validation flags set by the post-tools validation node. */
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
   * 旧实现让 `prepare_context` 先写 `[System, (memory), Human]`、再让下游想替换首条 ——
   * 实际是又追加了一遍，同一轮出现两条 System、两条用户消息（2026-10-07 定位，见计划 C7）。
   * 现在 `prepare_context` 只准备记忆块，`agent` 在**第一次**调用时一次性写出完整
   * 消息列表；工具循环的后续轮次只追加 assistant 与 tool 消息。
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

  /**
   * True when the loop stopped while the model still had tool calls pending.
   *
   * `pendingToolCalls` cannot carry this: `tools` clears it on every iteration,
   * so by the time `validate` runs it is empty whether the turn finished
   * naturally or was cut off by the cap. Without this flag the cap is
   * indistinguishable from an ordinary ending, and the reply silently presents a
   * truncated investigation as a complete answer.
   */
  loopCapped: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),

  /** LLM's text response when no more tools are needed. */
  finalContent: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),

  /** Tools selected by the LLM across all iterations. */
  selectedTools: Annotation<ToolName[]>({
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
