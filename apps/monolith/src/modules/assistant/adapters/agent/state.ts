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
/**
 * What `validate` decided about a turn's tool results.
 *
 * Re-exported from the port: the shape is shared by both runtimes and read by
 * the application layer, so it is not an adapter-owned type.
 */
export type { AssistantValidationFlags } from '../../application/ports/agent-runtime.js';
import type { AssistantValidationFlags } from '../../application/ports/agent-runtime.js';

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

  /**
   * External tool names the model has explicitly loaded this conversation.
   *
   * On-demand loading: the remote server's tools are **not** in the tool list
   * until `load_tools` names them, and this channel is what remembers that
   * across turns. Additive (`union`) because loading is monotonic within a
   * conversation — nothing unloads, and a resumed thread must keep what it
   * loaded before the suspension.
   *
   * Why not a process-level set: two conversations on one process must not see
   * each other's loaded tools. The checkpointer already scopes this channel to
   * a thread, which is exactly the boundary wanted.
   */
  loadedExternalTools: Annotation<string[]>({
    reducer: (left, right) => [...new Set([...left, ...right])],
    default: () => [],
  }),

  /** In-graph proposal review state (HITL); set before interrupt suspends the thread. */
  pendingReview: Annotation<AssistantPendingReview | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),

  // ── LLM conversation messages ──────────────────────────────────────────
  /**
   * The conversation transcript: assistant and tool messages, appended.
   *
   * Append reducer because the transcript genuinely only grows.
   *
   * ## The System header is not in here
   *
   * It used to be, written once by `prepare_context`. That made it
   * unrewritable — any later attempt to replace it appended a second one
   * instead (2026-10-07, two System messages in one turn — plan C7).
   *
   * The header is now rebuilt by the `agent` node on every step, from the tool
   * set that step actually binds, and prepended when the model is called.
   * That is what DSH does (`systemPrompt.assemble({ …, toolSet })` per step),
   * and it is load-bearing here: the bindable set is re-resolved per step, so
   * a once-per-turn prompt would keep advertising tools whose backend vanished
   * mid-turn.
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
