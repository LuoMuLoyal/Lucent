import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import {
  Command,
  type BaseCheckpointSaver,
  type StateSnapshot,
} from '@langchain/langgraph';
import {
  createDomainFailure,
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { DomainFailureException } from '../../../../common/result/domain-failure.exception.js';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import type { AssistantRuntimeCapabilities } from '../../application/ports/assistant.js';
import type {
  AssistantMessageResult,
  AssistantConversationMessage,
  AssistantProposedAction,
  AssistantStreamChunkEvent,
  AssistantToolExecutionResult,
} from '../../application/ports/assistant.js';
import {
  CONTEXT_SOURCES,
  TOOL_NAMES,
} from '../../domain/policies/tool-permission.js';
import type {
  ContextSource,
  ToolName,
} from '../../domain/policies/tool-permission.js';
import { AI_MODEL_TIMEOUT_MS } from '../../../../config/app-defaults.constants.js';
import type { LightragAvailability } from '../../application/ports/retrieval.js';
import {
  ASSISTANT_LIGHTRAG,
  ASSISTANT_SEMANTICA,
} from '../../application/ports/retrieval.js';
import { ASSISTANT_CHECKPOINTER } from '../../application/ports/agent-runtime.js';
import type { SemanticaAvailability } from '../../application/ports/retrieval.js';
import { toDomainFailure } from '../../application/services/provider-failures.js';
import {
  assistantSystemPromptVariables,
  buildAssistantSystemPrompt,
} from '../../application/services/prompts.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import { resolveRuntimePrompt } from '../../../../config/runtime/prompt-registry.js';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import {
  CODE_TOOL_LIMIT_BUDGETS,
  type ToolLimitBudgets,
} from '../acl/tools/shared/tool-definitions.js';
import { MAX_TOOL_LOOPS } from '../acl/tools/shared/tool-constants.js';
import { ASSISTANT_RUNTIME_NODE_NAMES } from './state.js';
import type { AssistantValidationFlags } from './state.js';
import type { AssistantPendingReview } from './state.js';
import type { CheckpointerPort } from '../../application/ports/agent-runtime.js';
import type { AssistantAgentMode } from '../../../settings/index.js';
import { IUserSettingsPort } from '../../../settings/index.js';
import { AssistantPolicyService } from '../../application/services/policy.js';
import { extractMessageText } from './message-text.js';
import type { ConversationRepositoryPort } from '../../domain/conversation/conversations.js';
import { ASSISTANT_CONVERSATIONS } from '../../domain/conversation/conversations.js';
import { AssistantStreamService } from '../../application/services/stream.js';
import {
  getLangfuseCallbackHandler,
  langfuseTraceConfig,
} from '../../../../common/llm/tracing/langfuse-callback.js';

import {
  ASSISTANT_NODE_TIMEOUT_MS,
  buildAssistantRuntimeGraph,
} from './graph.js';
import { runDeepAgentTurn } from './deep-agent-runner.js';
import {
  AMAP_MCP_SERVER_NAME,
  describeExternalTools,
  renderExternalToolCatalog,
} from '../../domain/mcp/external-tools.js';
import type { ExternalMcpPort } from '../../application/ports/external-mcp.js';
import { ASSISTANT_EXTERNAL_MCP } from '../../application/ports/external-mcp.js';
import { buildAssistantDeepAgent, deepAgentThreadId } from './deep-agent.js';
import { createProposalReviewMiddleware } from './proposal-review.js';
import type { DeepAgentPendingReview } from './proposal-review.js';
import type { AgentMiddleware } from 'langchain';
import type { ToolExecutorFn } from './deps.js';
import type { AssistantRespondCache } from './respond.js';

const CHAT_MODEL_OPTIONS = {
  timeout: AI_MODEL_TIMEOUT_MS,
  temperature: 0.2,
  maxRetries: 0, // retries handled by withLlmRetry
} as const;

/** Result of running the conversation tool-loop graph. */
export interface AssistantConversationResult {
  toolResults: AssistantToolExecutionResult[];
  finalContent: string | null;
  streamedContent: boolean;
  selectedTools: ToolName[];
  validationFlags: AssistantValidationFlags;
  stopReason:
    | 'answered'
    | 'no_match'
    | 'tool_cap_reached'
    | 'no_data'
    | 'no_target'
    | 'no_evidence'
    | 'awaiting_review'
    | null;
}

@Injectable()
export class AssistantRuntimeService {
  private readonly logger = new Logger(AssistantRuntimeService.name);

  constructor(
    private readonly llmRuntimeService: LlmRuntimeService,
    @Inject(ASSISTANT_LIGHTRAG)
    private readonly lightragClient: LightragAvailability,
    @Inject(ASSISTANT_SEMANTICA)
    private readonly semanticaClient: SemanticaAvailability,
    private readonly metricsService: MetricsService,
    private readonly circuitBreaker: LlmCircuitBreakerService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Inject(ASSISTANT_CHECKPOINTER)
    private readonly checkpointerService: CheckpointerPort,
    @Inject(ASSISTANT_CONVERSATIONS)
    private readonly conversationRepository: ConversationRepositoryPort,
    private readonly streamService: AssistantStreamService,
    @Optional()
    private readonly runtimeConfigService?: RuntimeConfigService,
    /** Global config module; absent only in tests that build this class by hand. */
    @Optional()
    private readonly configService?: ConfigService,
    /**
     * Remote map/weather MCP client. `@Optional()` so hand-built test instances
     * still construct; absent means no external tools are advertised.
     */
    @Optional()
    @Inject(ASSISTANT_EXTERNAL_MCP)
    private readonly amapMcpClient?: ExternalMcpPort,
    /**
     * Per-step capability re-resolution needs the user's current settings.
     * Optional so hand-built test instances still construct; absent means the
     * step keeps the turn's snapshot.
     */
    @Optional()
    private readonly userSettingsReader?: IUserSettingsPort,
    @Optional()
    private readonly policyService?: AssistantPolicyService,
  ) {}

  /**
   * Tool maxima advertised to the model for this turn. Read from the snapshot
   * so a published limit also widens (or narrows) what the model may ask for;
   * the server-side clamps read the same keys.
   */
  private readToolLimitBudgets(): ToolLimitBudgets {
    const values = this.runtimeConfigService?.getSnapshot().values;
    return {
      lightragMaxLimit:
        values?.[EnvKey.LIGHTRAG_MAX_LIMIT] ??
        CODE_TOOL_LIMIT_BUDGETS.lightragMaxLimit,
      semanticaMaxLimit:
        values?.[EnvKey.SEMANTICA_MAX_LIMIT] ??
        CODE_TOOL_LIMIT_BUDGETS.semanticaMaxLimit,
      semanticaReasonMaxLimit:
        values?.[EnvKey.SEMANTICA_REASON_MAX_LIMIT] ??
        CODE_TOOL_LIMIT_BUDGETS.semanticaReasonMaxLimit,
    };
  }

  /**
   * Node run timeout for this graph build. The snapshot key is authoritative;
   * the code constant is the default the schema mirrors.
   */
  private readNodeTimeoutMs(): number {
    return (
      this.runtimeConfigService?.getSnapshot().values[
        EnvKey.ASSISTANT_NODE_TIMEOUT_MS
      ] ?? ASSISTANT_NODE_TIMEOUT_MS
    );
  }

  /**
   * Tool-loop cap for this graph build.
   *
   * A runtime budget, not a code constant: the loop is the only thing bounding a
   * turn now that there is no router to narrow the tool set, so widening it is
   * an operational decision. The cap is surfaced to callers as
   * `stopReason: 'tool_cap_reached'` — never a silent truncation.
   */
  private readMaxToolLoops(): number {
    return (
      this.runtimeConfigService?.getSnapshot().values[
        EnvKey.ASSISTANT_MAX_TOOL_LOOPS
      ] ?? MAX_TOOL_LOOPS
    );
  }

  /**
   * Whether this turn runs on the deepagents backend.
   *
   * Two gates, both cheap reads:
   *
   * 1. The effective backend must be `'deepagents'`. That value comes from the
   *    user's `assistantAgentMode` setting when it is not `'default'`, else from
   *    the operator's `ASSISTANT_AGENT_RUNTIME` runtime key. Unknown values are
   *    treated as `'graph'` — an operator typo must select the proven path, not
   *    the experimental one.
   * 2. Proposal turns must be able to suspend there (see
   *    {@link deepAgentsSupportsProposals}).
   *
   * Subagent delegation *inside* the deepagents path is not routed here at
   * all: per the deepagents design, the model itself decides via `task()`,
   * reading each subagent's `description`. An external router would only
   * reintroduce the layer Phase 2 deleted.
   */
  private shouldUseDeepAgents(
    allowedTools: readonly ToolName[],
    mode: AssistantAgentMode,
  ): boolean {
    const value = this.resolveAgentRuntimeKey(mode);
    if (value !== 'deepagents') return false;
    return this.deepAgentsSupportsProposals(allowedTools);
  }

  /**
   * Whether the deepagents runtime can honour the proposal interrupt for this
   * turn.
   *
   * The interrupt comes from a `wrapToolCall` hook (`proposal-review.ts`) and
   * therefore needs a checkpointer to persist the suspension. When
   * checkpointing is unavailable the thread cannot suspend, so proposal turns
   * must stay on the graph — where the same limitation degrades to "no review"
   * instead of a failed turn.
   */
  private deepAgentsSupportsProposals(
    allowedTools: readonly ToolName[],
  ): boolean {
    const hasDraftTools = allowedTools.some((tool) => tool.endsWith('_draft'));
    if (!hasDraftTools) return true;
    return this.checkpointerService.getSaver() != null;
  }

  /**
   * Reads the backend preference for this turn, layering the user's choice over
   * the operator's.
   *
   * `default` means "whatever the operator published"; the other two values are
   * an explicit per-user override. Both paths normalise unknown input to
   * `'graph'` so a typo can never select the experimental backend.
   */
  private resolveAgentRuntimeKey(
    mode: AssistantAgentMode,
  ): 'graph' | 'deepagents' {
    if (mode === 'graph' || mode === 'deepagents') return mode;
    const raw =
      this.runtimeConfigService?.getSnapshot().values[
        EnvKey.ASSISTANT_AGENT_RUNTIME
      ] ?? 'graph';
    return raw === 'deepagents' ? 'deepagents' : 'graph';
  }

  /**
   * System prompt for the main agent: the published override when the operator
   * released one, else the code prompt. Resolved per invocation so a pushed
   * document applies to the next turn without rebuilding the graph.
   */
  private resolveAssistantSystemPrompt(
    toolNames: readonly ToolName[],
    externalToolCatalog = '',
  ): string {
    return resolveRuntimePrompt(
      this.runtimeConfigService,
      'assistantSystem',
      () => buildAssistantSystemPrompt(toolNames, externalToolCatalog),
      {
        ...assistantSystemPromptVariables(toolNames, externalToolCatalog),
        externalTools: externalToolCatalog,
      },
    );
  }

  /**
   * Renders the on-demand catalog for this turn's prompt.
   *
   * Empty when no external server is configured, when it is disabled, or when
   * it is unreachable — the prompt then simply has no on-demand section, which
   * is the same shape as a deployment that never configured one.
   */
  private async buildExternalToolCatalog(
    allowedTools: readonly ToolName[],
  ): Promise<string> {
    const client = this.amapMcpClient;
    if (client == null) return '';
    const remote = await client.listTools();
    if (remote.length === 0) return '';
    const definitions = describeExternalTools(
      AMAP_MCP_SERVER_NAME,
      remote,
      new Set(allowedTools),
    );
    return renderExternalToolCatalog(AMAP_MCP_SERVER_NAME, definitions);
  }

  /**
   * Re-resolves the bindable set for one model step.
   *
   * DSH's `tools.resolve()` calls every registration's `when({ agent })` once
   * per step. This is the same idea expressed against Lucent's inputs: the
   * capability verdict depends on `lightragClient.isEnabled()` /
   * `semanticaClient.isEnabled()` (both read the runtime snapshot live) and on
   * the user's stored settings, and neither is frozen for a turn.
   *
   * Returning the caller's set when nothing shrank keeps the common path free
   * of a settings round trip.
   */
  private async resolveStepAllowedTools(
    current: readonly ToolName[],
    userId: string,
  ): Promise<readonly ToolName[]> {
    const reader = this.userSettingsReader;
    const policy = this.policyService;
    // Both are optional together: a hand-built test instance has neither, and
    // the step then keeps the turn's snapshot unchanged.
    if (reader == null || policy == null) return current;

    const settings = await reader.getSettings(userId);
    // Switched off mid-turn: offer nothing rather than a snapshot the user has
    // already revoked.
    if (!settings.assistantEnabled) return [];

    const evaluated = policy.evaluate(this.describeFoundation(), settings);
    // Intersect with what the turn started with: this resolver may only take
    // tools away. A sidecar that comes up mid-turn must not hand the model a
    // tool the caller never cleared for this conversation.
    const allowed = new Set(evaluated.enabledToolNames);
    return current.filter((name) => allowed.has(name));
  }

  hasChatModel(): boolean {
    return this.llmRuntimeService.hasRoleConfig('chat');
  }

  /**
   * Langfuse handler for this service, or `null` when tracing is off or no
   * `ConfigService` was injected (tests construct this class without one).
   */
  private async langfuseHandler() {
    if (this.configService == null) {
      return null;
    }
    return getLangfuseCallbackHandler(this.configService);
  }

  /**
   * Simple-chat response cache backed by the shared cache-manager store.
   * TTL values from graph nodes are seconds; cache-manager expects ms.
   */
  private get respondCache(): AssistantRespondCache {
    return {
      get: async (key) => {
        const value = await this.cache.get<string>(key);
        this.metricsService.recordCacheAccess('response', value != null);
        return value ?? null;
      },
      set: async (key, value, ttlSeconds) => {
        await this.cache.set(key, value, ttlSeconds * 1000);
        this.logger.debug(
          `respondCache.set key="${key.slice(0, 60)}…" ttl=${String(ttlSeconds)}s`,
        );
      },
    };
  }

  /**
   * Runs the LangGraph tool-loop: the LLM decides which tools to call,
   * tools execute, and the loop continues until the LLM produces a text
   * response or the loop cap is reached.
   *
   * @param input - Conversation input.
   * @param executeTools - Callback to execute tools (provided by core service).
   * @returns Tool results and optional final content.
   */
  async runConversation(
    input: {
      userId: string;
      userMessage: string;
      locale: string;
      enabledContextSources: ContextSource[];
      /**
       * 本轮可绑定的工具集（候选集/硬上限），由 `policy.enabledToolNames` 算好传进来：
       * 用户 context 开关 ∩ 已实现 ∩ sidecar 可用。图的 `classify_intent` 只能在这个
       * 集合里选（降级"工具全开"也开到它为止）。
       */
      allowedTools: readonly ToolName[];
      /** Whether cross-conversation memory is enabled for this user. */
      memoryEnabled?: boolean;
      /** Whether this turn starts a new conversation. */
      isNewConversation?: boolean;
      /**
       * Prior turns of this conversation, oldest first, excluding the current
       * message.
       *
       * Comes from the request body (`dto.messages`) rather than the
       * checkpoint, because the graph also runs stateless (no `conversationId`)
       * where there is no checkpoint to read from. Length is bounded by the
       * caller; the router prompt clips per message.
       */
      conversationHistory?: readonly {
        role: 'user' | 'assistant';
        content: string;
      }[];
      /** Builds the persisted memory block (default: no memory injection). */
      buildMemoryBlock?: (userId: string) => Promise<string>;
      /**
       * Persisted conversation id used as the LangGraph thread id. When set
       * together with an available checkpointer, the turn runs with checkpoint
       * persistence and in-graph review; otherwise it stays stateless.
       */
      conversationId?: string;
      /**
       * The user's `assistantAgentMode` setting. `default` (or absent) follows
       * the operator's `ASSISTANT_AGENT_RUNTIME`; the other two override it.
       */
      agentMode?: AssistantAgentMode;
    },
    executeTools: ToolExecutorFn,
    onChunk?: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): Promise<AssistantConversationResult> {
    const checkpointer =
      this.checkpointerService.getSaver() as BaseCheckpointSaver | null;
    // HITL review (interrupt + confirm) only makes sense for a persisted
    // conversation; without `conversationId` the graph stays stateless and
    // never suspends, matching the degradation matrix.
    const enableHithl = input.conversationId != null && checkpointer != null;
    let streamedContent = false;

    // ── deepagents path ─────────────────────────────────────────────
    // Hot-switchable per turn. Proposal turns stay on the graph unless the
    // deepagents runtime can suspend the thread itself (it needs a
    // checkpointer for that). Any construction/run failure on the deepagents
    // path falls back to the graph for this turn — the proven path absorbs a
    // runtime-swap failure rather than turning it into a user-facing error.
    if (
      this.shouldUseDeepAgents(input.allowedTools, input.agentMode ?? 'default')
    ) {
      try {
        const runResult = await runDeepAgentTurn({
          createModel: () =>
            this.llmRuntimeService.createChatModel('chat', CHAT_MODEL_OPTIONS),
          toolNames: input.allowedTools,
          budgets: this.readToolLimitBudgets(),
          execute: (calls) => executeTools(calls),
          systemPrompt: this.resolveAssistantSystemPrompt(input.allowedTools),
          userMessage: input.userMessage,
          ...(input.conversationHistory != null
            ? { conversationHistory: input.conversationHistory }
            : {}),
          ...(input.conversationId != null
            ? { conversationId: input.conversationId }
            : {}),
          // Proposal suspension needs the saver; `shouldUseDeepAgents` already
          // refused the path when a draft tool is present and it is missing.
          checkpointer,
        });
        this.circuitBreaker.recordSuccess();
        return runResult;
      } catch (error) {
        this.logger.warn(
          `deepagents turn failed, falling back to the graph runtime: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Resolved once per turn: the same generation feeds the prompt catalog and
    // the loader's validation, so they cannot disagree about what is offered.
    const externalToolCatalog = await this.buildExternalToolCatalog(
      input.allowedTools,
    );

    const graph = buildAssistantRuntimeGraph({
      createModel: () =>
        this.llmRuntimeService.createChatModel('chat', CHAT_MODEL_OPTIONS),
      onText: async (content) => {
        streamedContent = true;
        await onChunk?.({ content });
      },
      executeTools,
      toolBudgets: () => this.readToolLimitBudgets(),
      nodeTimeoutMs: () => this.readNodeTimeoutMs(),
      maxToolLoops: () => this.readMaxToolLoops(),
      // Remote map/weather tools, when the operator configured them. The list
      // is empty when the client is disabled or the server is unreachable, so
      // this never fails a turn — it only adds tools the model may call.
      ...(this.amapMcpClient != null
        ? {
            listExternalTools: async () => {
              const client = this.amapMcpClient;
              if (client == null) return [];
              const remote = await client.listTools();
              return describeExternalTools(
                AMAP_MCP_SERVER_NAME,
                remote,
                new Set(input.allowedTools),
              );
            },
          }
        : {}),
      // Fetched once per turn and reused for both the prompt catalog and the
      // tool list, so the two can never describe different generations.
      externalToolCatalog,
      // Re-evaluated every step, like DSH's per-registration `when`.
      resolveAllowedTools: (current) =>
        this.resolveStepAllowedTools(current, input.userId),
      buildSystemPrompt: (toolNames) =>
        this.resolveAssistantSystemPrompt(toolNames, externalToolCatalog),
      ...(input.buildMemoryBlock != null
        ? { buildMemoryBlock: input.buildMemoryBlock }
        : {}),
      respondCache: this.respondCache,
      checkpointer: enableHithl ? checkpointer : null,
      ...(input.conversationId != null
        ? { conversationId: input.conversationId }
        : {}),
    });

    // Langfuse trace identity rides on `config.metadata.langfuse.*`; the
    // handler is a process-wide singleton, so the config is the only per-turn
    // binding. `null` handler (tracing off) yields `undefined` and the graph
    // runs exactly as before.
    const langfuse = langfuseTraceConfig(await this.langfuseHandler(), {
      userId: input.userId,
      ...(input.conversationId != null
        ? { sessionId: input.conversationId }
        : {}),
      tags: ['assistant'],
    });
    const config = {
      ...(enableHithl
        ? { configurable: { thread_id: input.conversationId } }
        : {}),
      ...langfuse,
    };
    // Acquire the circuit breaker before invoking the graph. The LangGraph
    // agent↔tools loop may issue multiple LLM calls inside a single
    // `graph.invoke()`; wrapping the whole invocation ensures that any LLM
    // failure surfaces to the breaker while avoiding double-counting retries
    // within one user request.
    this.circuitBreaker.acquire();
    try {
      const result = await graph.invoke(
        {
          userId: input.userId,
          userMessage: input.userMessage,
          locale: input.locale,
          enabledContextSources: input.enabledContextSources,
          allowedTools: [...input.allowedTools],
          memoryEnabled: input.memoryEnabled ?? false,
          isNewConversation: input.isNewConversation ?? false,
          conversationHistory: [...(input.conversationHistory ?? [])],
        },
        config,
      );
      this.circuitBreaker.recordSuccess();
      return {
        toolResults: result.toolResults,
        finalContent: result.finalContent,
        streamedContent,
        selectedTools: result.selectedTools,
        validationFlags: result.validationFlags,
        stopReason: result.stopReason,
      };
    } catch (error) {
      this.circuitBreaker.recordFailure();
      throw error;
    }
  }

  /**
   * Resumes a suspended thread after the client confirmed or rejected the
   * pending proposals.
   *
   * Two runtimes can suspend a thread, so two checkpoint formats exist:
   *
   * - **graph** — the conversation id is the thread id, the review lives in
   *   graph state, and resuming re-enters at `write_review`.
   * - **deepagents** — the thread id is `deep-{conversationId}` and the review
   *   is middleware state written by `proposal-review.ts`.
   *
   * Which one to resume is decided by where the pending review actually is, not
   * by the current runtime setting: the backend can be switched between the
   * turn that suspended and the confirm call. The graph thread is checked first
   * because it is the older format (a turn may have suspended before this
   * change).
   *
   * A missing/non-pending review in both is an expected client failure and
   * becomes a `ResultAsync` Err (VALIDATION_FAILED); unknown failures re-throw.
   */
  resumeConversation(input: {
    userId: string;
    conversationId: string;
    decision: 'approved' | 'rejected';
    note?: string;
  }): ResultAsync<{ finalContent: string | null }, DomainFailure> {
    return fromPromise(this.doResumeConversation(input), (error) =>
      this.toDomainFailure(error),
    );
  }

  private async doResumeConversation(input: {
    userId: string;
    conversationId: string;
    decision: 'approved' | 'rejected';
    note?: string;
  }): Promise<{ finalContent: string | null }> {
    const langfuse = langfuseTraceConfig(await this.langfuseHandler(), {
      userId: input.userId,
      sessionId: input.conversationId,
      tags: ['assistant', 'resume'],
    });

    const graphPending = await this.readGraphPendingReview(
      input.conversationId,
    );
    if (graphPending != null) {
      return this.resumeGraphThread(input, graphPending, langfuse);
    }

    const deepPending = await this.readDeepAgentPendingReview(
      input.conversationId,
    );
    if (deepPending != null) {
      return this.resumeDeepAgentThread(input, langfuse);
    }

    throw new DomainFailureException(
      createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        // Registry owns outbound copy (ADR-0012); keep the specific
        // direction in `cause` for logs only.
        cause: 'no_pending_proposal_review',
      }),
    );
  }

  /** The graph thread's pending review, or `null` when it is not suspended. */
  private async readGraphPendingReview(
    conversationId: string,
  ): Promise<AssistantPendingReview | null> {
    const graph = this.buildGraphWithCheckpointer(conversationId);
    const snapshot = await graph.getState({
      configurable: { thread_id: conversationId },
    });
    const pending = (
      snapshot.values as { pendingReview?: AssistantPendingReview }
    ).pendingReview;
    return pending != null && pending.status === 'pending' ? pending : null;
  }

  /**
   * The deepagents thread's pending review, or `null` when that thread does not
   * exist / is not suspended. Read failures are treated as "not this format":
   * a missing deep thread is the normal case on a graph-only conversation.
   */
  private async readDeepAgentPendingReview(
    conversationId: string,
  ): Promise<DeepAgentPendingReview | null> {
    const checkpointer =
      this.checkpointerService.getSaver() as BaseCheckpointSaver | null;
    if (checkpointer == null) return null;
    try {
      const values = await this.readDeepAgentValues(
        conversationId,
        checkpointer,
        [],
      );
      const pending = values?.pendingReview;
      return pending != null && pending.status === 'pending' ? pending : null;
    } catch (error) {
      this.logger.debug(
        `deepagents thread has no resumable review for "${conversationId}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async resumeGraphThread(
    input: {
      userId: string;
      conversationId: string;
      decision: 'approved' | 'rejected';
      note?: string;
    },
    _pending: AssistantPendingReview,
    langfuse: ReturnType<typeof langfuseTraceConfig>,
  ): Promise<{ finalContent: string | null }> {
    const graph = this.buildGraphWithCheckpointer(input.conversationId);
    const threadConfig = { configurable: { thread_id: input.conversationId } };

    // The resume turn is a separate trace from the turn that suspended: it
    // re-enters the graph at `write_review`, so it produces its own model call
    // and its own Langfuse trace, tied to the same session.
    const result = await graph.invoke(
      new Command({ resume: { decision: input.decision, note: input.note } }),
      { ...threadConfig, ...langfuse },
    );
    return { finalContent: result.finalContent ?? null };
  }

  /**
   * Resumes the deepagents thread with the client's decision.
   *
   * The agent is rebuilt rather than cached: the checkpointer holds the state,
   * and rebuilding keeps this path identical to a fresh turn (same tools, same
   * prompt resolution). `Command({ resume })` feeds the value back to the
   * `interrupt` call in `proposal-review.ts`, which then continues the loop.
   */
  private async resumeDeepAgentThread(
    input: {
      userId: string;
      conversationId: string;
      decision: 'approved' | 'rejected';
      note?: string;
    },
    langfuse: ReturnType<typeof langfuseTraceConfig>,
  ): Promise<{ finalContent: string | null }> {
    const checkpointer =
      this.checkpointerService.getSaver() as BaseCheckpointSaver | null;
    if (checkpointer == null) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message:
          'Checkpoint persistence is unavailable; cannot resume the review.',
      });
    }

    const agent = buildAssistantDeepAgent({
      model: this.llmRuntimeService.createChatModel('chat', CHAT_MODEL_OPTIONS),
      toolNames: [],
      budgets: this.readToolLimitBudgets(),
      execute: () => Promise.resolve([]),
      systemPrompt: '',
      conversationId: input.conversationId,
      checkpointer,
      middleware: [createProposalReviewMiddleware([])],
    });

    // `ReactAgent.invoke`'s input union is derived from the compiled graph's
    // generics and does not admit `Command` in the published typings, even
    // though resuming with `Command({ resume })` is the documented path. The
    // narrowing lives here so every other call site keeps its typed input.
    const resumable = agent as unknown as {
      invoke: (
        input: Command,
        config: Record<string, unknown>,
      ) => Promise<{ messages?: unknown[] }>;
    };

    const result = await resumable.invoke(
      new Command({
        resume: {
          decision: input.decision,
          ...(input.note != null ? { note: input.note } : {}),
        },
      }),
      {
        configurable: {
          thread_id: deepAgentThreadId(input.conversationId),
        },
        ...langfuse,
      },
    );

    return { finalContent: this.lastAssistantText(result.messages ?? []) };
  }

  private lastAssistantText(messages: readonly unknown[]): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!AIMessage.isInstance(message)) continue;
      const text = extractMessageText([message]);
      if (text.trim().length > 0) return text;
    }
    return null;
  }

  /**
   * Reads the pending review and its proposals from the suspended thread's
   * checkpoint without resuming it. The confirm endpoint uses this to apply
   * approved writes server-side before the thread resumes.
   *
   * Both runtimes are consulted, in the same order {@link resumeConversation}
   * uses: whichever thread actually holds the pending review is the one whose
   * proposals the caller must apply.
   */
  async readPendingProposals(conversationId: string): Promise<{
    pendingReview: AssistantPendingReview | null;
    proposals: AssistantProposedAction[];
  }> {
    const graph = this.buildGraphWithCheckpointer(conversationId);
    const config = { configurable: { thread_id: conversationId } };

    const snapshot = await graph.getState(config);
    const values = snapshot.values as {
      pendingReview?: AssistantPendingReview;
      toolResults?: AssistantToolExecutionResult[];
    };
    if (values.pendingReview != null) {
      return {
        pendingReview: values.pendingReview,
        proposals: (values.toolResults ?? []).flatMap(
          (result) => result.proposedActions ?? [],
        ),
      };
    }

    const deepValues = await this.readDeepAgentState(conversationId);
    return {
      pendingReview: deepValues?.pendingReview ?? null,
      proposals: deepValues?.proposals ?? [],
    };
  }

  /**
   * Reads the deepagents thread's persisted state, or `null` when that thread
   * does not exist (the normal case for a graph-only conversation).
   */
  private async readDeepAgentState(conversationId: string): Promise<{
    pendingReview: AssistantPendingReview | null;
    proposals: AssistantProposedAction[];
  } | null> {
    const checkpointer =
      this.checkpointerService.getSaver() as BaseCheckpointSaver | null;
    if (checkpointer == null) return null;
    try {
      const values = await this.readDeepAgentValues(
        conversationId,
        checkpointer,
        [],
      );
      if (values == null) return null;
      return {
        pendingReview: values.pendingReview ?? null,
        proposals: values.proposals ?? [],
      };
    } catch (error) {
      this.logger.debug(
        `deepagents state unavailable for "${conversationId}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Reads the deepagents thread's state bag.
   *
   * `ReactAgent.getState` is marked `@internal` with a `never` return type in
   * the published typings, so the result has to be re-typed here. The runtime
   * value is a normal LangGraph `StateSnapshot`; only the state keys this file
   * reads are named.
   */
  private async readDeepAgentValues(
    conversationId: string,
    checkpointer: BaseCheckpointSaver,
    middleware: readonly AgentMiddleware[],
  ): Promise<{
    pendingReview?: AssistantPendingReview;
    proposals?: AssistantProposedAction[];
  } | null> {
    const agent = buildAssistantDeepAgent({
      model: this.llmRuntimeService.createChatModel('chat', CHAT_MODEL_OPTIONS),
      // The read path never executes tools; an empty set keeps the agent
      // constructible without recomputing permissions.
      toolNames: [],
      budgets: this.readToolLimitBudgets(),
      execute: () => Promise.resolve([]),
      systemPrompt: '',
      conversationId,
      checkpointer,
      ...(middleware.length > 0 ? { middleware } : {}),
    });
    const stateful = agent as unknown as {
      getState: (config: { configurable: { thread_id: string } }) => Promise<{
        values?: {
          pendingReview?: AssistantPendingReview;
          proposals?: AssistantProposedAction[];
        };
      }>;
    };
    const snapshot = await stateful.getState({
      configurable: { thread_id: deepAgentThreadId(conversationId) },
    });
    return snapshot.values ?? null;
  }

  /**
   * Streams a final response to the client, either by chunking pre-generated
   * content or by making a new streaming LLM call with tool context.
   */
  async generateStream(
    input: {
      locale: string;
      messages: AssistantConversationMessage[];
      allowedTools: readonly ToolName[];
      toolResults: readonly AssistantToolExecutionResult[];
    },
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): Promise<AssistantMessageResult> {
    return this.streamService.generateStream(input, onChunk);
  }

  /**
   * Streams pre-generated content (from the graph's agent node) to the client
   * as word-level chunks. Used when the LangGraph tool-loop produced a final
   * text response without needing a separate streaming call.
   */
  async streamPreGeneratedContent(
    content: string,
    toolResults: readonly AssistantToolExecutionResult[],
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): Promise<AssistantMessageResult> {
    return this.streamService.streamPreGeneratedContent(
      content,
      toolResults,
      onChunk,
    );
  }

  describeFoundation(): AssistantRuntimeCapabilities {
    const chatModelConfigured = this.hasChatModel();
    // 中文散文检索的可用性 = sidecar 已启用且 key 就位。旧实现的
    // `hasIndexedChunks()` 读的是 Lucent 自己的 chunk 表——那是旧向量链路的
    // 遗留判据，LightRAG 时代查它只会得到一个与检索能力无关的数字。
    const retrievalAvailable = this.lightragClient.isEnabled();
    // 英文侧 OAG 与中文侧检索各自独立判定：一个 sidecar 挂掉不该把另一个的
    // 工具也标成不可用（计划 §2 的语言边界，在可用性判定上同样成立）。
    const oagAvailable = this.semanticaClient.isEnabled();
    return {
      phase: 'foundation',
      chatModelConfigured,
      interactiveChatReady: chatModelConfigured,
      langGraphReady: true,
      ragEnabled: chatModelConfigured && retrievalAvailable,
      retrievalAvailable,
      oagAvailable,
      graphNodeNames: ASSISTANT_RUNTIME_NODE_NAMES,
      toolNames: TOOL_NAMES,
      implementedToolNames: TOOL_NAMES,
      contextSources: CONTEXT_SOURCES,
    };
  }

  /**
   * Builds the persisted graph for a conversation thread. Requires checkpoint
   * persistence (badRequest otherwise): the resume and pending-proposal-read
   * paths only make sense for checkpointed threads.
   */
  private buildGraphWithCheckpointer(
    conversationId: string,
    onText?: (text: string) => void | Promise<void>,
  ) {
    const checkpointer =
      this.checkpointerService.getSaver() as BaseCheckpointSaver | null;
    if (checkpointer == null) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message:
          'Checkpoint persistence is unavailable; cannot resume the review.',
      });
    }

    return buildAssistantRuntimeGraph({
      createModel: () =>
        this.llmRuntimeService.createChatModel('chat', CHAT_MODEL_OPTIONS),
      // The resume/read path never reaches the agent↔tools loop; tools are
      // only executed by the original (now suspended) invocation.
      executeTools: () => Promise.resolve([]),
      toolBudgets: () => this.readToolLimitBudgets(),
      nodeTimeoutMs: () => this.readNodeTimeoutMs(),
      maxToolLoops: () => this.readMaxToolLoops(),
      buildSystemPrompt: (toolNames) =>
        this.resolveAssistantSystemPrompt(toolNames),
      ...(onText != null ? { onText } : {}),
      respondCache: this.respondCache,
      checkpointer,
      conversationId,
    });
  }

  /**
   * Locates the LangGraph checkpoint right before the last assistant answer
   * was produced (the `respond` node) and records the message→checkpoint
   * mapping for a later time-travel regeneration (F-5b).
   *
   * The caller must hold a conversation whose last persisted message is an
   * assistant reply. Only the latest such answer can be regenerated; the
   * checkpoint is matched by `next` containing `respond` and by the final
   * assistant message text equal to the persisted one (message 定位).
   *
   * Idempotency: a regeneration for the same (conversation, source message)
   * within 30 seconds is rejected with RESOURCE_CONFLICT.
   *
   * Expected client failures (conversation missing, invalid state, duplicate
   * regeneration) become `ResultAsync` Errs; unknown failures re-throw.
   */
  regenerateLastMessage(
    userId: string,
    conversationId: string,
  ): ResultAsync<
    { checkpointId: string; sourceMessageId: string },
    DomainFailure
  > {
    return fromPromise(
      this.doRegenerateLastMessage(userId, conversationId),
      (error) => this.toDomainFailure(error),
    );
  }

  private async doRegenerateLastMessage(
    userId: string,
    conversationId: string,
  ): Promise<{ checkpointId: string; sourceMessageId: string }> {
    const conversation = await this.conversationRepository.find(
      userId,
      conversationId,
    );
    if (conversation == null || conversation.status === 'deleted') {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'not_found',
          code: 'RESOURCE_NOT_FOUND',
          cause: 'conversation_not_found',
        }),
      );
    }

    const dbMessages = conversation.messages;
    const lastDbMessage = dbMessages.at(-1);
    if (lastDbMessage == null || lastDbMessage.role !== 'assistant') {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'validation',
          code: 'VALIDATION_FAILED',
          cause: 'only_last_message_regenerable',
        }),
      );
    }
    const lastDbContent = lastDbMessage.content;

    const graph = this.buildGraphWithCheckpointer(conversationId);
    const config = { configurable: { thread_id: conversationId } };

    const history: StateSnapshot[] = [];
    try {
      for await (const snapshot of graph.getStateHistory(config)) {
        history.push(snapshot);
      }
    } catch (error) {
      this.logger.error(
        `getStateHistory failed for conversation ${conversationId}: ${String(error)}`,
      );
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'internal',
          code: 'INTERNAL_ERROR',
          cause: 'generation_history_unreadable',
        }),
      );
    }

    // Newest first; the checkpoint right before `respond` still lists it in
    // `next` and ends with the assistant message that produced the answer.
    const target = history.find((snapshot) => {
      if (!snapshot.next.includes('respond')) {
        return false;
      }
      const rawValues = snapshot.values as Record<string, unknown>;
      const rawMessages = rawValues['messages'];
      if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
        return false;
      }
      const last = rawMessages.at(-1) as BaseMessage;
      if (last.type !== 'ai') {
        return false;
      }
      return extractMessageText(last.content) === lastDbContent;
    });

    if (target == null) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'validation',
          code: 'VALIDATION_FAILED',
          cause: 'last_message_generation_state_missing',
        }),
      );
    }
    const checkpointId =
      target.config.configurable == null
        ? undefined
        : (target.config.configurable['checkpoint_id'] as string | undefined);
    if (checkpointId == null) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'validation',
          code: 'VALIDATION_FAILED',
          cause: 'last_message_generation_state_missing',
        }),
      );
    }

    const recent = await this.conversationRepository.findRecentRegeneration(
      conversationId,
      lastDbMessage.id,
    );
    if (recent != null) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'conflict',
          code: 'RESOURCE_CONFLICT',
          cause: 'regeneration_in_progress',
        }),
      );
    }

    await this.conversationRepository.createRegeneration({
      conversationId,
      userId,
      sourceMessageId: lastDbMessage.id,
      checkpointId,
    });

    return { checkpointId, sourceMessageId: lastDbMessage.id };
  }

  /**
   * Converts a DomainFailureException raised inside the imperative body into
   * the Result Err; a provider failure becomes a `dependency` DomainFailure so
   * the transport reports a model outage as such; anything else is re-thrown so
   * it reaches the transport boundary unchanged. Shared with the other
   * collapsed-`ResultAsync` boundaries — see {@link toDomainFailure}.
   */
  private toDomainFailure(error: unknown): DomainFailure {
    return toDomainFailure(error);
  }

  /**
   * Time-travel replay: forks the thread from the checkpoint recorded by
   * {@link regenerateLastMessage}, clears `finalContent`/`stopReason` so the
   * `respond` node re-streams a fresh answer, and appends the new assistant
   * message to the thread (the old answer stays in the history). Returns the
   * newly generated content.
   */
  async replayFromCheckpoint(
    conversationId: string,
    checkpointId: string,
    onText: (text: string) => void | Promise<void>,
  ): Promise<{ finalContent: string }> {
    const graph = this.buildGraphWithCheckpointer(conversationId, onText);
    const config = { configurable: { thread_id: conversationId } };

    // Fork the thread from the recorded checkpoint and clear the final
    // content so `respond` re-streams a fresh answer. `asNode` is left to
    // inference: the inferred writer (the last node that ran, e.g. the
    // sub-graph) also replays its conditional branch, so the fork resumes at
    // `respond` exactly as the original invocation did.
    await graph.updateState(
      {
        configurable: {
          thread_id: conversationId,
          checkpoint_id: checkpointId,
          checkpoint_ns: '',
        },
      },
      { finalContent: null, stopReason: null },
    );

    const result: { finalContent?: string | null } = await graph.invoke(
      null,
      config,
    );
    const finalContent = result.finalContent ?? '';
    if (finalContent.trim().length === 0) {
      const cause = new Error(
        'Assistant regeneration ended without any content.',
      );
      this.logger.error(
        { stack: cause.stack },
        `Assistant regeneration produced no content (conversationId=${conversationId}, checkpointId=${checkpointId}).`,
      );
      trace.getActiveSpan()?.recordException(cause);
      trace.getActiveSpan()?.addEvent('assistant.regeneration.no_content', {
        conversation_id: conversationId,
        checkpoint_id: checkpointId,
      });
      throw new InternalServerErrorException({
        code: 'ASSISTANT_REGENERATION_NO_CONTENT',
        message: 'Assistant regeneration could not produce a response.',
      });
    }

    // `respond` writes only `finalContent`; persist the new answer into the
    // thread so future turns see it (the old assistant message is retained).
    await graph.updateState(
      config,
      { messages: [new AIMessage(finalContent)] },
      'respond',
    );

    return { finalContent };
  }
}
