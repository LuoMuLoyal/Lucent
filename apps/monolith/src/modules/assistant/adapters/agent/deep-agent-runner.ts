/**
 * Runs one assistant turn on the deepagents backend.
 *
 * ## Why this adapter exists
 *
 * `buildAssistantDeepAgent` assembles the agent; this module is the seam the
 * production runtime calls. It exists because deepagents' run output differs
 * from the hand-written graph's `AssistantConversationResult`, and the two must
 * never be reconciled inside `runtime.ts` — that file owns the switch, not the
 * translation.
 *
 * ## What is deliberately out of scope here
 *
 * - **HITL proposals**: the confirm endpoint resumes a *graph* interrupt
 *   (`write_review`). deepagents would need its own suspension mechanism, and
 *   two suspension mechanisms over one conversation is the exact drift the
 *   plan (§6.1) forbids. The runner therefore reports proposals through the
 *   normal result envelope and the caller decides what to do — in practice,
 *   `runtime.ts` routes any turn with draft tools to the graph path first.
 * - **Checkpointing**: deepagents gets no checkpointer. Regeneration keys on
 *   the graph's checkpoints (`AssistantCheckpointerService`); a second one
 *   would disagree about what "the current state" is.
 * - **Streaming**: deepagents owns its run loop and does not emit per-token
 *   text the way `graph.ts`'s `onText` does. `streamedContent` is always
 *   `false` and the caller turns the finished message into word-level chunks,
 *   so the client-visible SSE contract (`chunk` → `result` → `done`) is
 *   unchanged.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import type {
  AssistantToolCall,
  AssistantToolExecutionResult,
} from '../../application/ports/assistant.js';
import type { ToolLimitBudgets } from '../acl/tools/shared/tool-definitions.js';
import { buildAssistantDeepAgent } from './deep-agent.js';
import type { AssistantConversationResult } from './runtime.js';
import type { AssistantValidationFlags } from './state.js';

/** All a deepagents turn needs — the same material `graph.ts` receives. */
export interface DeepAgentRunnerDeps {
  createModel: () => BaseChatModel;
  /** Permission-filtered candidate set — the same list `graph.ts` binds. */
  toolNames: readonly ToolName[];
  /** Live advertised maxima, so zod bounds match what the server clamps. */
  budgets: ToolLimitBudgets;
  /** The production executor (`AssistantToolService.executeMany` shape). */
  execute: (
    calls: readonly AssistantToolCall[],
  ) => Promise<AssistantToolExecutionResult[]>;
  systemPrompt: string;
  /** The user's message for this turn. */
  userMessage: string;
  /** Prior turns, oldest first, excluding the current message. */
  conversationHistory?: readonly { role: 'user' | 'assistant'; content: string }[];
  conversationId?: string;
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
              .map(
                (part) =>
                  typeof part === 'object' &&
                  part != null &&
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
 * Executes one turn and maps the output onto `AssistantConversationResult`.
 *
 * Tool results are captured by wrapping `execute` rather than by scraping the
 * message list: the envelopes (coverage, ambiguities, proposedActions) are the
 * caller's validation input, and the bridge renders them to the model as text —
 * the structured originals never reach the messages.
 */
export async function runDeepAgentTurn(
  deps: DeepAgentRunnerDeps,
): Promise<AssistantConversationResult> {
  const toolResults: AssistantToolExecutionResult[] = [];

  const agent = buildAssistantDeepAgent({
    model: deps.createModel(),
    toolNames: deps.toolNames,
    budgets: deps.budgets,
    execute: async (calls) => {
      const results = await deps.execute(calls);
      toolResults.push(...results);
      return results;
    },
    systemPrompt: deps.systemPrompt,
    ...(deps.conversationId != null
      ? { conversationId: deps.conversationId }
      : {}),
  });

  const history = (deps.conversationHistory ?? []).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const output = (await agent.invoke({
    messages: [...history, { role: 'user', content: deps.userMessage }],
  })) as { messages?: unknown[] };

  const messages = output.messages ?? [];
  const finalContent = finalContentOf(messages);
  const usedTools = [
    ...new Set(
      toolResults.map((result) => result.name),
    ),
  ];

  return {
    toolResults,
    finalContent,
    streamedContent: false,
    selectedTools: usedTools,
    validationFlags: NO_FLAGS,
    stopReason: finalContent != null ? 'answered' : 'no_match',
  };
}
