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
 * The graph in `graph.ts` is **not** deleted here. It stays selectable at
 * runtime (`ASSISTANT_AGENT_RUNTIME` / the user's `assistantAgentMode`), because
 * the two differ in ways that matter:
 *
 * - `graph.ts` streams through `onText` and returns the assistant's own
 *   `AssistantConversationResult` shape.
 * - deepagents owns its own run loop and streams `messages` / `files` state.
 *
 * ## Checkpointing
 *
 * The agent gets **its own** thread namespace (`deep-{conversationId}`) rather
 * than the conversation id the graph uses. Both runtimes write to the same
 * `AssistantCheckpointerService` schema, so sharing a thread id would mean two
 * different state shapes overwriting each other's checkpoint — `getState` would
 * then answer with whichever runtime wrote last. The separate namespace keeps
 * `regenerateLastMessage` (graph-only, keyed on graph checkpoint ids) correct.
 *
 * A checkpointer is also what makes `interrupt` work at all: without one
 * LangGraph has nowhere to persist the suspension. `proposal-review.ts` relies
 * on that.
 *
 * ## What is deliberately *not* configured
 *
 * - **No `memory` / `skills` paths.** Those read files from the backend root at
 *   agent construction; the workspace is per-conversation and empty by design.
 * - **No `interruptOn`.** See `proposal-review.ts`: deepagents' HITL interrupts
 *   *before* a tool runs, but a proposal only exists *after* its draft tool has
 *   run. The proposal flow therefore interrupts from a `wrapToolCall` hook.
 */
import { createDeepAgent } from 'deepagents';
import { LocalShellBackend } from 'deepagents';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentMiddleware } from 'langchain';
import type { ReactAgent } from 'langchain';
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

/**
 * Thread-id namespace for the deepagents runtime.
 *
 * Kept distinct from the graph's (bare conversation id) so the two runtimes
 * never read each other's state. Exported because the resume path has to build
 * the same id.
 */
export function deepAgentThreadId(conversationId: string): string {
  return `deep-${conversationId}`;
}

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
  /** Conversation id; scopes the workspace and the checkpoint thread. */
  conversationId?: string;
  /**
   * Checkpoint saver. Required for proposal suspension to work — without it
   * `interrupt` has nowhere to persist. Callers pass the shared
   * `AssistantCheckpointerService` saver.
   */
  checkpointer?: BaseCheckpointSaver | null;
  /**
   * Extra middleware. Used for the proposal-review hook, which needs the
   * runner's accumulator.
   */
  middleware?: readonly AgentMiddleware[];
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
export function buildAssistantDeepAgent(
  options: AssistantDeepAgentOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the concrete generic instantiates a private LangGraph type (`StreamTransformer`) that cannot be named portably
): ReactAgent<any> {
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
    ...(options.checkpointer != null
      ? { checkpointer: options.checkpointer }
      : {}),
    ...(options.middleware != null && options.middleware.length > 0
      ? { middleware: [...options.middleware] }
      : {}),
    name: 'lucent',
  });
}
