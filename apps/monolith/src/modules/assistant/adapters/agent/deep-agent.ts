/**
 * deepagents assembly for one assistant turn.
 *
 * ## Where this sits
 *
 * Phase 2 collapsed the assistant onto a hand-written ReAct loop
 * (`graph.ts`: `agent ⇄ tools`). This module is the next step: the same topology,
 * but driven by `createDeepAgent` so the turn also gets planning
 * (`write_todos`), a filesystem, shell access, and `task` delegation to
 * sub-agents with isolated context windows.
 *
 * The graph in `graph.ts` is **not** deleted here. It stays as the execution
 * path until this one is proven, because the two differ in ways that matter:
 *
 * - `graph.ts` streams through `onText` and returns the assistant's own
 *   `AssistantConversationResult` shape.
 * - deepagents owns its own run loop and streams `messages` / `files` state.
 *
 * Wiring deepagents in behind the same port is a separate, verifiable step; this
 * module is the piece that makes it possible to try.
 *
 * ## What is deliberately *not* configured
 *
 * - **No `checkpointer`.** The assistant already owns conversation persistence
 *   (`AssistantCheckpointerService`) and a regeneration model keyed on
 *   checkpoint ids. Two checkpointers over one thread would disagree about what
 *   "the current state" is.
 * - **No `memory` / `skills` paths.** Those read files from the backend root at
 *   agent construction; the workspace is per-conversation and empty by design.
 * - **No `interruptOn`.** HITL is the assistant's proposal flow, which suspends
 *   on `write_review` in `graph.ts` and is resumed by the confirm endpoint.
 *   deepagents' interrupt would be a second suspension mechanism for the same
 *   decision.
 */
import { createDeepAgent } from 'deepagents';
import { LocalShellBackend } from 'deepagents';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredTool } from '@langchain/core/tools';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import type { ToolLimitBudgets } from '../acl/tools/shared/tool-definitions.js';
import type {
  AssistantToolCall,
  AssistantToolExecutionResult,
} from '../../application/ports/assistant.js';
import { buildDeepAgentTools } from './tool-bridge.js';
import { ASSISTANT_SUBAGENTS } from './subagents.js';
import {
  AGENT_SHELL_MAX_OUTPUT_BYTES,
  AGENT_SHELL_TIMEOUT_SECONDS,
  resolveAgentWorkspace,
  scrubEnvironment,
} from './workspace.js';

/** Everything one turn's deep agent needs. */
export interface AssistantDeepAgentOptions {
  /** The chat model, created by the caller so its config stays in one place. */
  model: BaseChatModel;
  /** Permission-filtered tool names — the same set `graph.ts` binds. */
  toolNames: readonly ToolName[];
  /** Live tool budgets, so advertised ranges match what the server accepts. */
  budgets: ToolLimitBudgets;
  /** The production executor: `AssistantToolService.executeMany`. */
  execute: (
    calls: readonly AssistantToolCall[],
  ) => Promise<AssistantToolExecutionResult[]>;
  /** System prompt (already resolved, including any runtime override). */
  systemPrompt: string;
  /** Conversation id; scopes the workspace and appears in logs. */
  conversationId?: string;
}

/**
 * Builds a deep agent for one turn.
 *
 * The backend is `LocalShellBackend` — **unconfined shell execution on the host**.
 * `workspace.ts` explains what is and is not guarded there: a dedicated scratch
 * directory and a scrubbed environment, but no process or network isolation.
 *
 * The model-facing consequence is accepted deliberately: an agent that can run
 * `env` or read `~/.ssh` is reachable by anything that can influence its prompt.
 * Confining it is a separate change (container per session); this module should
 * not grow a partial fence that reads as protection without being one.
 */
export function buildAssistantDeepAgent(options: AssistantDeepAgentOptions) {
  const workspace = resolveAgentWorkspace(options.conversationId);

  const tools: StructuredTool[] = buildDeepAgentTools({
    toolNames: options.toolNames,
    budgets: options.budgets,
    execute: options.execute,
  });

  return createDeepAgent({
    model: options.model,
    systemPrompt: options.systemPrompt,
    tools,
    subagents: [...ASSISTANT_SUBAGENTS],
    backend: new LocalShellBackend({
      rootDir: workspace,
      // Treat the workspace as the virtual root for the file tools: `..` and
      // absolute paths outside it are rejected. This fence does **not** cover
      // shell commands (see workspace.ts).
      virtualMode: true,
      timeout: AGENT_SHELL_TIMEOUT_SECONDS,
      maxOutputBytes: AGENT_SHELL_MAX_OUTPUT_BYTES,
      // A scrubbed environment, not the host's: the process holds the database
      // URL, Redis password and provider keys, and anything the model runs
      // inherits whatever is here.
      env: scrubEnvironment(),
      inheritEnv: false,
    }),
    ...(options.conversationId != null ? { name: 'lucent' } : {}),
  });
}
