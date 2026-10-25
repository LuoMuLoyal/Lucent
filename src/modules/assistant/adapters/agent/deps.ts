/**
 * What the graph nodes need from the outside world (ADR-0024 `adapters/agent`).
 *
 * This contract lives in its own file on purpose: `graph.ts` assembles the
 * graph and the sub-graphs under `subgraphs/` are passed the same object, so
 * declaring it in `graph.ts` made graph -> subgraph -> graph a cycle. A types-only
 * module breaks that cycle without changing a single behaviour — the dependency
 * direction is now graph -> subgraphs -> deps, one-way.
 *
 * Type-only on purpose: nothing here may import a runtime value, or the cycle
 * comes back through the emitted `import` statements.
 */
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ToolName, ContextSource } from '../../domain/policies/tool-permission.js';
import type {
  AssistantToolCall,
  AssistantToolExecutionResult,
} from '../../application/ports/assistant.js';
import type { ToolLimitBudgets } from '../acl/tools/shared/tool-definitions.js';
import type { AssistantToolRoutingOutcome } from '../../application/services/intent.js';
import type { AssistantRespondCache } from './respond.js';

/** Callback type for executing tools inside the graph. */
export type ToolExecutorFn = (
  toolCalls: readonly AssistantToolCall[],
) => Promise<AssistantToolExecutionResult[]>;

/** Callback type for creating the LLM model. */
export type ModelFactoryFn = () => BaseChatModel;

/** Callback type for building the system prompt. */
export type SystemPromptFn = (tools: readonly ToolName[]) => string;

/** Callback type for building the simple-chat system prompt (no tools). */
export type SimpleChatPromptFn = () => string;

export type AssistantTextCallback = (text: string) => void | Promise<void>;

export interface AssistantGraphDeps {
  createModel: ModelFactoryFn;
  onText?: AssistantTextCallback;
  executeTools: ToolExecutorFn;
  buildSystemPrompt: SystemPromptFn;
  /** Advertised tool limits for this build (read per turn). */
  toolBudgets?: () => ToolLimitBudgets;
  /** Per-node run timeout; the resolver exists because it tracks tunable budgets. */
  nodeTimeoutMs?: () => number;
  /**
   * Per-turn tool selection port (production: `AssistantIntentClassifierService`).
   *
   * Absent means the node **does not throw**: it degrades to "bind every
   * candidate tool + intent=mixed", which the `degraded_all_tools` metric
   * exposes. There is no keyword fallback — the rule table is gone.
   */
  routeTools?: (input: {
    userMessage: string;
    locale: string;
    enabledContextSources: readonly ContextSource[];
    candidateTools: readonly ToolName[];
  }) => Promise<AssistantToolRoutingOutcome>;
  /** Intent-specific prompt builders; fall back to buildSystemPrompt when absent. */
  buildReadSystemPrompt?: SystemPromptFn;
  buildWriteSystemPrompt?: SystemPromptFn;
  buildKnowledgeSystemPrompt?: SystemPromptFn;
  buildSimpleChatSystemPrompt?: SimpleChatPromptFn;
  /** Builds the persisted cross-conversation memory block for a user. */
  buildMemoryBlock?: (userId: string) => Promise<string>;
  /** Simple-chat response cache; when absent, replies are not cached. */
  respondCache?: AssistantRespondCache;
  /** Postgres-backed checkpointer; when null the graph stays stateless. */
  checkpointer?: BaseCheckpointSaver | null;
  /** Persisted conversation id, used as the LangGraph thread id. */
  conversationId?: string;
}
