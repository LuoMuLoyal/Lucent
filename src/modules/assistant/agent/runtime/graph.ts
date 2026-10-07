import { END, START, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { InMemoryCache } from '@langchain/langgraph-checkpoint';
import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { isRetryableLlmError } from '../../../../common/llm/retry/llm-retry.helper.js';
import { AI_MODEL_TIMEOUT_MS } from '../../../../config/app-defaults.constants.js';
import {
  MAX_TOOL_LOOPS,
  ONTOLOGY_TOOL_EXECUTION_TIMEOUT_MS,
  RETRIEVAL_TOOL_EXECUTION_TIMEOUT_MS,
  TOOL_EXECUTION_TIMEOUT_MS,
} from '../../tools/shared/tool-constants.js';
import type { AssistantToolName } from '../../tools/shared/tool-types.js';
import type {
  AssistantToolCall,
  AssistantToolExecutionResult,
} from '../../types/assistant.types.js';
import { AssistantRuntimeState } from './state.js';
import { deriveIntent, type AssistantIntent } from './classify.js';
import type { AssistantToolRoutingOutcome } from './classify.js';
import type { AssistantContextSource } from '../../tools/shared/tool-types.js';
import { buildRespondNode, type AssistantRespondCache } from './respond.js';
import { createAgentNode, createToolsNode } from './nodes.js';
import { buildReadSubGraph } from './subgraphs/read.js';
import { buildWriteSubGraph } from './subgraphs/write.js';
import { buildKnowledgeSubGraph } from './subgraphs/knowledge.js';
import { createWriteReviewNode, createWriteReviewSetupNode } from './review.js';

export {
  AssistantRuntimeState,
  ASSISTANT_RUNTIME_NODE_NAMES,
} from './state.js';
export { selectAllowedToolsForContextSources } from './tool-permissions.js';
export { deriveIntent, type AssistantIntent } from './classify.js';
export type { AssistantToolRoutingOutcome } from './classify.js';
export { buildRespondNode } from './respond.js';
export { buildReadSubGraph } from './subgraphs/read.js';
export { buildWriteSubGraph } from './subgraphs/write.js';
export { buildKnowledgeSubGraph } from './subgraphs/knowledge.js';

/**
 * Process-wide shared node cache. Nodes that opt into `cachePolicy` share this
 * instance across `buildAssistantRuntimeGraph` calls, so deterministic nodes
 * (classify_intent, prepare_context) are memoized between user requests.
 */
const ASSISTANT_NODE_CACHE = new InMemoryCache();

/** TTL for deterministic-rule node caching (seconds). */
const NODE_CACHE_TTL_SECONDS = 3600;

/**
 * Run timeout for a single node of the assistant runtime graph.
 *
 * A node is not one model call. `agent` streams a model response and the
 * tool-running nodes (including the sub-graphs, which execute tools inside
 * their own node) may run a tool whose own budget is far larger than the model
 * timeout — `reason_over_ontology` alone allows 45s for generation plus the
 * sidecar round trip.
 *
 * Bounding nodes by the *model* timeout put the ceiling below the tools' own
 * budgets, so those budgets could never be reached: the node was cancelled at
 * 10s, LangGraph retried it, and (measured through the assistant SSE endpoint)
 * the client received the start of each attempt's answer before the turn failed
 * with `Node "agent" exceeded its run timeout`. The node bound is therefore one
 * model call plus a full tool budget, with the per-tool timeouts and the tool's
 * internal budget still doing the real limiting.
 */
export const ASSISTANT_NODE_TIMEOUT_MS =
  AI_MODEL_TIMEOUT_MS +
  Math.max(
    TOOL_EXECUTION_TIMEOUT_MS,
    ONTOLOGY_TOOL_EXECUTION_TIMEOUT_MS,
    RETRIEVAL_TOOL_EXECUTION_TIMEOUT_MS,
  ) +
  5_000;

/** Callback type for executing tools inside the graph. */
export type ToolExecutorFn = (
  toolCalls: readonly AssistantToolCall[],
) => Promise<AssistantToolExecutionResult[]>;

/** Callback type for creating the LLM model. */
export type ModelFactoryFn = () => BaseChatModel;

/** Callback type for building the system prompt. */
export type SystemPromptFn = (tools: readonly AssistantToolName[]) => string;

/** Callback type for building the simple-chat system prompt (no tools). */
export type SimpleChatPromptFn = () => string;
export type AssistantTextCallback = (text: string) => void | Promise<void>;

export interface AssistantGraphDeps {
  createModel: ModelFactoryFn;
  onText?: AssistantTextCallback;
  executeTools: ToolExecutorFn;
  buildSystemPrompt: SystemPromptFn;
  /**
   * 每轮工具选择的端口（生产实现 = `AssistantIntentClassifierService`）。
   *
   * 缺省时节点**不抛**，而是走"绑定全部候选工具 + intent=mixed"的降级 —— 生产里
   * 缺这根线是接线错误，指标上的 `degraded_all_tools` 会立刻暴露；测试里不注入
   * 即为"路由不可用"的确定性场景。**没有关键词回退**：规则表已整体退役。
   */
  routeTools?: (input: {
    userMessage: string;
    locale: string;
    enabledContextSources: readonly AssistantContextSource[];
    candidateTools: readonly AssistantToolName[];
  }) => Promise<AssistantToolRoutingOutcome>;
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
  /**
   * Postgres-backed checkpointer (from `AssistantCheckpointerService`).
   * When null the graph skips the in-graph review nodes and keeps the old
   * stateless write flow.
   */
  checkpointer?: BaseCheckpointSaver | null;
  /** Persisted conversation id; used as the LangGraph thread id by the caller. */
  conversationId?: string;
}

/**
 * 选本轮工具：正常走注入的模型路由端口；端口缺失时降级为**全部候选工具**。
 *
 * 降级不抛异常、也不回退到任何规则子集 —— 关键词机制已整体退役，唯一的兜底就是
 * "把可用的都绑上、交给通用 agent 节点"，并让指标上的 `degraded_all_tools` 可见。
 */
function routeTools(
  deps: AssistantGraphDeps,
  state: AssistantRuntimeState,
  candidateTools: readonly AssistantToolName[],
): Promise<AssistantToolRoutingOutcome> {
  if (deps.routeTools == null) {
    return Promise.resolve({
      source: 'degraded_all_tools',
      reason: 'no tool router is wired',
    });
  }
  return deps.routeTools({
    userMessage: state.userMessage,
    locale: state.locale,
    enabledContextSources: state.enabledContextSources,
    candidateTools,
  });
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
  const checkpointer = deps.checkpointer ?? null;
  const hasHithl = checkpointer != null;

  const builder = new StateGraph(AssistantRuntimeState)
    // ── prepare_context ────────────────────────────────────────────────
    .addNode('prepare_context', async (state) => {
      // 只做"取上下文"：候选工具集由调用方算好（含 sidecar 可用性），记忆块在这里
      // 取好但**先不写消息** —— system prompt 要等意图选定才能确定，而 `messages`
      // 是 append reducer，先写再改会追加出第二份 System + 用户消息（计划 C7）。
      let memoryBlock = '';
      if (
        state.memoryEnabled &&
        state.isNewConversation &&
        deps.buildMemoryBlock != null
      ) {
        memoryBlock = await deps.buildMemoryBlock(state.userId);
      }

      return {
        memoryBlock,
        memoryInjected: memoryBlock.length > 0,
        loopCount: 0,
        pendingToolCalls: [],
        toolResults: [],
        finalContent: null,
        selectedTools: [],
        stopReason: null,
      };
    })

    // ── classify_intent ────────────────────────────────────────────────
    // 模型选工具（确定性规则表已整体退役）。这一步不便宜，节点级 cachePolicy
    // 覆盖图级 `cachePolicy: false`，同一 (用户, 消息, 候选集) 在 TTL 内复用。
    // 失败不抛：降级为"绑定全部候选工具 + intent=mixed"，走通用 agent 节点。
    .addNode(
      'classify_intent',
      async (state: AssistantRuntimeState) => {
        const candidateTools = state.allowedTools;
        const routing = await routeTools(deps, state, candidateTools);
        // 降级 = 绑定**全部候选工具**（不是某个规则子集，规则表已退役）。
        // 正常路径则把模型的选择与候选集求交：路由端口无论返回什么（模型幻觉、
        // 提示注入、注入的测试替身），候选集都是硬上限。真源在分类器里（会记 warn），
        // 这一层是契约自守。
        const permitted = new Set(candidateTools);
        const selectedTools =
          routing.source === 'degraded_all_tools'
            ? [...candidateTools]
            : routing.tools.filter((tool) => permitted.has(tool));

        // 意图一律从"本轮真正绑定的工具集"派生。
        //
        // 降级时绑定的是整个候选集，而生产里的候选集总是同时含知识类与写入类工具，
        // 于是自然派生成 `mixed` → 通用 agent 节点（这正是降级想要的形状）；窄候选集
        // （例如只剩写入工具）仍会走它该走的子图，而不是被强行塞进通用节点。
        const intent: AssistantIntent =
          selectedTools.length === 0
            ? 'simple_chat'
            : deriveIntent(selectedTools);

        const systemPrompt = selectSystemPrompt(deps, intent, selectedTools);
        // 一次性写出完整消息列表：此刻 `messages` 还是空的（prepare_context 没写），
        // 所以 append 的结果就是唯一一份。
        const messages: BaseMessage[] = [new SystemMessage(systemPrompt)];
        if (state.memoryInjected) {
          messages.push(new HumanMessage(state.memoryBlock));
        }
        messages.push(new HumanMessage(state.userMessage));

        return {
          intent,
          relevantTools: selectedTools,
          routingSource: routing.source,
          messages,
        };
      },
      {
        cachePolicy: { ttl: NODE_CACHE_TTL_SECONDS },
        // 重试由 `withLlmRetry`（3 次）负责；图级默认的 maxAttempts=3 会与之相乘
        // （最多 9 次模型调用），所以这里把本节点的重试关掉（maxAttempts: 1）。
        retryPolicy: { maxAttempts: 1 },
      },
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
        ...(deps.onText != null ? { onText: deps.onText } : {}),
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
      timeout: ASSISTANT_NODE_TIMEOUT_MS,
      cachePolicy: false,
    });

  // HITL review: when a checkpointer is available, write proposals pause at
  // `write_review` until the client confirms via the confirm endpoint.
  // Without a checkpointer (or without a thread) the write sub-graph flows
  // straight to `respond` exactly as before.
  if (hasHithl) {
    builder
      .addNode('write_review_setup', createWriteReviewSetupNode())
      .addNode('write_review', createWriteReviewNode())
      .addConditionalEdges('write_subgraph', (state) =>
        state.stopReason === 'no_target' ? 'respond' : 'write_review_setup',
      )
      .addEdge('write_review_setup', 'write_review')
      .addEdge('write_review', 'respond');
  } else {
    builder.addEdge('write_subgraph', 'respond');
  }

  return builder.compile({
    cache: ASSISTANT_NODE_CACHE,
    ...(hasHithl ? { checkpointer } : {}),
  });
}
