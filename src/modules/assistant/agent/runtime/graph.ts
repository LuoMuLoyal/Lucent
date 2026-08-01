import { END, START, StateGraph } from '@langchain/langgraph';
import { InMemoryCache } from '@langchain/langgraph-checkpoint';
import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { isRetryableLlmError } from '../../../../common/llm/llm-retry.helper';
import { AI_MODEL_TIMEOUT_MS } from '../../../../config/constants';
import { MAX_TOOL_LOOPS } from '../../tools/shared/tool-constants';
import type { AssistantToolName } from '../../tools/shared/tool-types';
import type { AssistantToolExecutionResult } from '../../types/assistant.types';
import { AssistantRuntimeState } from './state';
import { selectAllowedToolsForContextSources } from './router';
import { classifyIntent, type AssistantIntent } from './classify';
import { buildRespondNode, type AssistantRespondCache } from './respond';
import { createAgentNode, createToolsNode } from './nodes';
import { buildReadSubGraph } from './subgraphs/read';
import { buildWriteSubGraph } from './subgraphs/write';
import { buildKnowledgeSubGraph } from './subgraphs/knowledge';

export { AssistantRuntimeState, ASSISTANT_RUNTIME_NODE_NAMES } from './state';
export { selectAllowedToolsForContextSources } from './router';
export { classifyIntent, type AssistantIntent } from './classify';
export { buildRespondNode } from './respond';
export { buildReadSubGraph } from './subgraphs/read';
export { buildWriteSubGraph } from './subgraphs/write';
export { buildKnowledgeSubGraph } from './subgraphs/knowledge';

/**
 * Process-wide shared node cache. Nodes that opt into `cachePolicy` share this
 * instance across `buildAssistantRuntimeGraph` calls, so deterministic nodes
 * (classify_intent, prepare_context) are memoized between user requests.
 */
const ASSISTANT_NODE_CACHE = new InMemoryCache();

/** TTL for deterministic-rule node caching (seconds). */
const NODE_CACHE_TTL_SECONDS = 3600;

/** Callback type for executing tools inside the graph. */
export type ToolExecutorFn = (
  toolNames: readonly AssistantToolName[],
) => Promise<AssistantToolExecutionResult[]>;

/** Callback type for creating the LLM model. */
export type ModelFactoryFn = () => BaseChatModel;

/** Callback type for building the system prompt. */
export type SystemPromptFn = (tools: readonly AssistantToolName[]) => string;

/** Callback type for building the simple-chat system prompt (no tools). */
export type SimpleChatPromptFn = () => string;

export interface AssistantGraphDeps {
  createModel: ModelFactoryFn;
  executeTools: ToolExecutorFn;
  buildSystemPrompt: SystemPromptFn;
  /** Intent-specific prompt builders; fall back to buildSystemPrompt when absent. */
  buildReadSystemPrompt?: SystemPromptFn;
  buildWriteSystemPrompt?: SystemPromptFn;
  buildKnowledgeSystemPrompt?: SystemPromptFn;
  buildSimpleChatSystemPrompt?: SimpleChatPromptFn;
  /**
   * Builds the persisted cross-conversation memory block for a user.
   * Called by `prepare_context` when `memoryEnabled && isNewConversation`.
   */
  buildMemoryBlock?: (userId: string) => Promise<string>;
  /** Simple-chat response cache; when absent, replies are not cached. */
  respondCache?: AssistantRespondCache;
}

/** Picks the system prompt for the classified intent, falling back to the generic builder. */
function selectSystemPrompt(
  deps: AssistantGraphDeps,
  intent: AssistantIntent,
  relevantTools: readonly AssistantToolName[],
): string {
  switch (intent) {
    case 'simple_chat':
      return (
        deps.buildSimpleChatSystemPrompt?.() ??
        deps.buildSystemPrompt(relevantTools)
      );
    case 'read_data':
      return (
        deps.buildReadSystemPrompt?.(relevantTools) ??
        deps.buildSystemPrompt(relevantTools)
      );
    case 'write_proposal':
      return (
        deps.buildWriteSystemPrompt?.(relevantTools) ??
        deps.buildSystemPrompt(relevantTools)
      );
    case 'knowledge':
      return (
        deps.buildKnowledgeSystemPrompt?.(relevantTools) ??
        deps.buildSystemPrompt(relevantTools)
      );
    case 'mixed':
      return deps.buildSystemPrompt(relevantTools);
  }
}

/**
 * Builds a LangGraph with a real agent ↔ tools loop and intent routing.
 *
 * Graph structure:
 * ```
 * START → prepare_context → classify_intent ─┬→ respond (simple_chat)
 *                                             ├→ read_subgraph (read_data)
 *                                             ├→ write_subgraph (write_proposal)
 *                                             ├→ knowledge_subgraph (knowledge)
 *                                             └→ agent ↔ tools (mixed/fallback)
 * read/write/knowledge subgraph → respond → END
 * ```
 *
 * - `prepare_context` sets up allowed tools and initial messages.
 * - `classify_intent` runs the keyword router, narrowing `relevantTools` and
 *   tagging the message with a semantic `intent`.
 * - `agent` calls the LLM with the narrowed tools bound. If the LLM returns
 *   tool calls, routes to `tools`. Otherwise stores the text response and
 *   routes to `respond`.
 * - `tools` executes the requested tools, appends ToolMessages, and loops
 *   back to `agent`.
 * - Loop is capped at {@link MAX_TOOL_LOOPS}.
 */
export function buildAssistantRuntimeGraph(deps: AssistantGraphDeps) {
  return (
    new StateGraph(AssistantRuntimeState)
      // ── prepare_context ────────────────────────────────────────────────
      .addNode('prepare_context', async (state) => {
        const allowedTools = selectAllowedToolsForContextSources(
          state.enabledContextSources,
        );
        const systemPrompt = deps.buildSystemPrompt(allowedTools);
        const messages: BaseMessage[] = [new SystemMessage(systemPrompt)];
        let memoryInjected = false;

        // Cross-conversation memory only makes sense at the start of a new
        // conversation. It is injected as a HumanMessage so `classify_intent`
        // (which rewrites only the leading SystemMessage) keeps it in context.
        if (
          state.memoryEnabled &&
          state.isNewConversation &&
          deps.buildMemoryBlock != null
        ) {
          const memoryBlock = await deps.buildMemoryBlock(state.userId);
          if (memoryBlock.length > 0) {
            messages.push(new HumanMessage(memoryBlock));
            memoryInjected = true;
          }
        }

        messages.push(new HumanMessage(state.userMessage));
        return {
          allowedTools,
          messages,
          memoryInjected,
          loopCount: 0,
          pendingToolCalls: [],
          toolResults: [],
          finalContent: null,
          selectedTools: [],
          stopReason: null,
        };
      })

      // ── classify_intent ────────────────────────────────────────────────
      // Pure rule-based routing is deterministic and cheap to memoize; the
      // node-level cachePolicy overrides the graph-wide `cachePolicy: false`.
      .addNode(
        'classify_intent',
        (state: AssistantRuntimeState) => {
          const { intent, relevantTools } = classifyIntent(
            state.userMessage,
            state.allowedTools,
          );
          const systemPrompt = selectSystemPrompt(deps, intent, relevantTools);
          const messages = [
            new SystemMessage(systemPrompt),
            ...state.messages.slice(1),
          ];
          return { intent, relevantTools, messages };
        },
        { cachePolicy: { ttl: NODE_CACHE_TTL_SECONDS } },
      )

      // ── agent / tools ──────────────────────────────────────────────────
      .addNode('agent', createAgentNode(deps))
      .addNode('tools', createToolsNode(deps))
      .addNode('read_subgraph', buildReadSubGraph(deps))
      .addNode('write_subgraph', buildWriteSubGraph(deps))
      .addNode('knowledge_subgraph', buildKnowledgeSubGraph(deps))

      // ── respond ────────────────────────────────────────────────────────
      .addNode(
        'respond',
        buildRespondNode({
          createModel: deps.createModel,
          ...(deps.respondCache != null
            ? { respondCache: deps.respondCache }
            : {}),
        }),
      )

      // ── Edges ──────────────────────────────────────────────────────────
      .addEdge(START, 'prepare_context')
      .addEdge('prepare_context', 'classify_intent')
      .addConditionalEdges('classify_intent', (state) => {
        // simple_chat skips the agent node entirely and goes straight to
        // respond; read/write/knowledge route to their sub-graphs; mixed and
        // unknown intents use the full agent node.
        switch (state.intent) {
          case 'simple_chat':
            return 'respond';
          case 'read_data':
            return 'read_subgraph';
          case 'write_proposal':
            return 'write_subgraph';
          case 'knowledge':
            return 'knowledge_subgraph';
          default:
            return 'agent';
        }
      })
      .addConditionalEdges('agent', (state) => {
        if (
          state.pendingToolCalls.length > 0 &&
          state.loopCount < MAX_TOOL_LOOPS
        ) {
          return 'tools';
        }
        if (
          state.pendingToolCalls.length > 0 &&
          state.loopCount >= MAX_TOOL_LOOPS
        ) {
          return 'respond';
        }
        return 'respond';
      })
      .addEdge('tools', 'agent')
      .addEdge('read_subgraph', 'respond')
      .addEdge('write_subgraph', 'respond')
      .addEdge('knowledge_subgraph', 'respond')
      .addEdge('respond', END)
      // Graph-wide node defaults: every node inherits these unless it opts
      // out via addNode(..., { retryPolicy: false }). `retryOn` is an explicit
      // whitelist so non-transient errors (400/401) are never retried.
      .setNodeDefaults({
        retryPolicy: {
          retryOn: isRetryableLlmError,
          maxAttempts: 3,
        },
        timeout: AI_MODEL_TIMEOUT_MS,
        cachePolicy: false,
      })
      .compile({ cache: ASSISTANT_NODE_CACHE })
  );
}
