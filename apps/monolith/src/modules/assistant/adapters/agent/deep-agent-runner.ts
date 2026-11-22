/**
 * Runs one deepagents turn and maps its output onto the assistant's own
 * `AssistantConversationResult`.
 *
 * ## Why a runner and not the agent itself
 *
 * `createDeepAgent` returns a LangGraph runnable with its own run loop and its
 * own state (`messages` / `files` / middleware state). The rest of the assistant
 * — SSE chunking, persistence, validation flags — speaks
 * `AssistantConversationResult`. This module is that seam, and it is
 * deliberately thin: everything it adds is a mapping, never policy.
 *
 * ## Known deviation: no token streaming
 *
 * `streamedContent` is always `false`; the caller streams the finished text
 * through `streamPreGeneratedContent` so the SSE contract (`chunk` → `result`
 * → `done`) stays byte-identical to the graph path. True token streaming would
 * mean consuming deepagents' stream mode and re-implementing the graph's
 * `onText` semantics on top of it, which is a separate change.
 *
 * ## Proposals and checkpoints
 *
 * A turn whose candidate set contains a `*_draft` tool needs the proposal to
 * suspend the thread (so the confirm endpoint can resume it). That suspension
 * comes from `proposal-review.ts`, which needs a checkpointer; the runner passes
 * one through when the caller supplied it. Without a checkpointer the
 * middleware's `interrupt` has nowhere to persist and the turn fails — the
 * caller is responsible for not routing proposal turns here in that case
 * (`runtime.ts` checks it).
 */
import { AIMessage } from '@langchain/core/messages';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { CODE_TOOL_LIMIT_BUDGETS } from '../acl/tools/shared/tool-definitions.js';
import { buildAssistantDeepAgent, deepAgentThreadId } from './deep-agent.js';
import { createProposalReviewMiddleware } from './proposal-review.js';
import type {
  AssistantToolCall,
  AssistantToolExecutionResult,
} from '../../application/ports/assistant.js';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import type { AssistantValidationFlags } from '../../application/ports/agent-runtime.js';
import type { ConversationRunResult } from '../../application/ports/agent-runtime.js';

/** Everything one turn needs from the caller. */
export interface DeepAgentRunnerDeps {
  /** Builds the chat model (the caller owns its config). */
  createModel: () => unknown;
  toolNames: readonly ToolName[];
  budgets?: typeof CODE_TOOL_LIMIT_BUDGETS;
  execute: (
    calls: readonly AssistantToolCall[],
  ) => Promise<AssistantToolExecutionResult[]>;
  systemPrompt: string;
  /** The user's message for this turn. */
  userMessage: string;
  /** Prior turns, oldest first, excluding the current message. */
  conversationHistory?: readonly {
    role: 'user' | 'assistant';
    content: string;
  }[];
  conversationId?: string;
  /** Checkpoint saver; enables proposal suspension and turn persistence. */
  checkpointer?: BaseCheckpointSaver | null;
}

/** Renders the final assistant text out of a deepagents run's message list. */
function finalContentOf(messages: readonly unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!AIMessage.isInstance(message)) continue;
    const content = message.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((part) =>
                typeof part === 'object' &&
                'text' in part &&
                typeof part.text === 'string'
                  ? part.text
                  : '',
              )
              .join('')
          : '';
    if (text.trim().length > 0) return text;
  }
  return null;
}

const NO_FLAGS: AssistantValidationFlags = {
  hasEmptyResults: false,
  hasPartialCoverage: false,
  hasAmbiguities: false,
  missingProposedActions: false,
};

/**
 * Executes one turn and maps the output onto `ConversationRunResult`.
 *
 * Tool results are captured by wrapping `execute` rather than by scraping the
 * message list: the envelopes (coverage, ambiguities, proposedActions) are the
 * caller's validation input, and the bridge renders them to the model as text —
 * the structured originals never reach the messages.
 */
export async function runDeepAgentTurn(
  deps: DeepAgentRunnerDeps,
): Promise<ConversationRunResult> {
  const toolResults: AssistantToolExecutionResult[] = [];

  const agent = buildAssistantDeepAgent({
    model: deps.createModel() as never,
    toolNames: deps.toolNames,
    budgets: deps.budgets ?? CODE_TOOL_LIMIT_BUDGETS,
    execute: async (calls) => {
      const results = await deps.execute(calls);
      toolResults.push(...results);
      return results;
    },
    systemPrompt: deps.systemPrompt,
    ...(deps.conversationId != null
      ? { conversationId: deps.conversationId }
      : {}),
    ...(deps.checkpointer != null ? { checkpointer: deps.checkpointer } : {}),
    // The middleware reads proposals from the same accumulator `execute`
    // fills, so it never re-parses a tool message.
    middleware: [createProposalReviewMiddleware(toolResults)],
  });

  const history = (deps.conversationHistory ?? []).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const config =
    deps.conversationId != null && deps.checkpointer != null
      ? { configurable: { thread_id: deepAgentThreadId(deps.conversationId) } }
      : {};

  const output = (await agent.invoke(
    {
      messages: [...history, { role: 'user', content: deps.userMessage }],
    },
    config,
  )) as { messages?: unknown[]; pendingReview?: { status?: string } };

  const messages = output.messages ?? [];
  const finalContent = finalContentOf(messages);
  const usedTools = [...new Set(toolResults.map((result) => result.name))];
  const suspended = output.pendingReview?.status === 'pending';

  const result: ConversationRunResult = {
    toolResults,
    finalContent,
    streamedContent: false,
    selectedTools: usedTools,
    validationFlags: NO_FLAGS,
    stopReason: suspended
      ? 'awaiting_review'
      : finalContent != null
        ? 'answered'
        : 'no_match',
  };
  return result;
}
