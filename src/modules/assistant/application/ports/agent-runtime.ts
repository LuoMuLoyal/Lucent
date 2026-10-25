/**
 * Agent runtime port (ADR-0024 `application/ports`).
 *
 * The use cases orchestrate a conversation turn; the LangGraph assembly and the
 * tool loop are adapters. Without this port the application layer imported
 * `adapters/agent/checkpoint-runtime.ts` and `adapters/acl/tool-executor.ts`
 * directly, which points the dependency the wrong way.
 *
 * The port names what orchestration needs and nothing more; the checkpoint,
 * thread-id and graph-replay mechanics stay in the adapter.
 */

import type {
  AssistantConversationMessage,
  AssistantMessageResult,
  AssistantStreamChunkEvent,
  AssistantToolCall,
  AssistantToolExecutionResult,
  AssistantRuntimeCapabilities,
} from './assistant.js';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import type { ProposedAction } from '../../domain/proposal/proposed-action.js';

/** DI tokens — strings so a Nest resolution error names the port readably. */
export const ASSISTANT_AGENT_RUNTIME = 'ASSISTANT_AGENT_RUNTIME';
export const ASSISTANT_TOOL_EXECUTOR = 'ASSISTANT_TOOL_EXECUTOR';

/** Result of running the tool-loop graph for one turn. */
export interface ConversationRunResult {
  toolResults: AssistantToolExecutionResult[];
  finalContent: string | null;
  streamedContent: boolean;
  selectedTools: ToolName[];
  stopReason: string | null;
}

/** Executes the tool calls one model turn asked for. */
export interface ToolExecutorPort {
  executeMany(
    context: AssistantToolCallContext,
    calls: readonly AssistantToolCall[],
  ): Promise<AssistantToolExecutionResult[]>;
}

/** Context of the tool calls being executed in this turn. */
export interface AssistantToolCallContext {
  userId: string;
  locale: 'zh-CN' | 'en';
  userMessage: string;
  enabledContextSources: readonly string[];
  memoryEnabled: boolean;
}

/** The graph runtime the stream orchestrator drives. */
/** A proposal as the adapter hands it over: the domain value object verbatim. */
export type ProposedActionView = ProposedAction;

/** The review the thread is suspended at, as the port exposes it. */
export interface PendingReviewView {
  status: 'pending' | 'approved' | 'rejected';
}

export interface AgentRuntimePort {
  describeFoundation(): AssistantRuntimeCapabilities;

  runConversation(
    input: {
      userId: string;
      userMessage: string;
      locale: string;
      enabledContextSources: string[];
      allowedTools: readonly ToolName[];
      memoryEnabled?: boolean;
      isNewConversation?: boolean;
      buildMemoryBlock?: (userId: string) => Promise<string>;
      conversationId?: string;
    },
    executeTools: (
      toolCalls: readonly AssistantToolCall[],
    ) => Promise<AssistantToolExecutionResult[]>,
    onChunk?: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): Promise<ConversationRunResult>;

  streamPreGeneratedContent(
    content: string,
    toolResults: readonly AssistantToolExecutionResult[],
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): Promise<AssistantMessageResult>;

  generateStream(
    input: {
      locale: string;
      messages: AssistantConversationMessage[];
      allowedTools: readonly ToolName[];
      toolResults: readonly AssistantToolExecutionResult[];
    },
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): Promise<AssistantMessageResult>;

  regenerateLastMessage(
    userId: string,
    conversationId: string,
  ): Promise<{ checkpointId: string; sourceMessageId: string }>;

  /** Resumes the suspended thread after the user decided on its proposals. */
  resumeConversation(input: {
    userId: string;
    conversationId: string;
    decision: 'approved' | 'rejected';
    note?: string;
  }): Promise<{ finalContent: string | null }>;

  /**
   * Reads the pending review and its proposals from the suspended thread without
   * resuming it — the confirm path applies the approved writes first.
   */
  readPendingProposals(conversationId: string): Promise<{
    pendingReview: PendingReviewView | null;
    proposals: ProposedActionView[];
  }>;

  replayFromCheckpoint(
    conversationId: string,
    checkpointId: string,
    onText: (text: string) => void | Promise<void>,
  ): Promise<{ finalContent: string }>;
}
