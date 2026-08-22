import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Command, type StateSnapshot } from '@langchain/langgraph';
import { badRequest, conflict, notFound } from '../../../common';
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { LlmRuntimeService } from '../../../llm-runtime';
import { MetricsService } from '../../../common/metrics/metrics.service';
import type { AssistantRuntimeCapabilities } from '../types/assistant.types';
import type {
  AssistantMessageResult,
  AssistantConversationMessage,
  AssistantProposedAction,
  AssistantStreamChunkEvent,
  AssistantToolExecutionResult,
} from '../types/assistant.types';
import {
  ASSISTANT_CONTEXT_SOURCES,
  ASSISTANT_IMPLEMENTED_TOOL_NAMES,
  ASSISTANT_TOOL_NAMES,
} from '../tools/shared/tool-types';
import type {
  AssistantContextSource,
  AssistantToolName,
} from '../tools/shared/tool-types';
import { AI_MODEL_TIMEOUT_MS } from '../../../config/constants';
import { AssistantToolLeafletReadService } from '../tools/leaflet/read.service';
import {
  buildAssistantSystemPrompt,
  buildReadSystemPrompt,
  buildWriteSystemPrompt,
  buildKnowledgeSystemPrompt,
  buildSimpleChatSystemPrompt,
} from '../prompts/system.prompt';
import { ASSISTANT_RUNTIME_NODE_NAMES } from './runtime/state';
import type { AssistantValidationFlags } from './runtime/state';
import type { AssistantPendingReview } from './runtime/state';
import { AssistantCheckpointerService } from './checkpointer.service';
import { extractMessageText } from './runtime/message-text.utils';
import { AssistantConversationRepositoryPort } from '../repositories/conversation.repository';

import {
  buildAssistantRuntimeGraph,
  type ToolExecutorFn,
} from './runtime/graph';
import type { AssistantRespondCache } from './runtime/respond';
import {
  withLlmRetry,
  isRetryableLlmError,
} from '../../../common/llm/llm-retry.helper';
import { LlmCircuitBreakerService } from '../../../common/llm/llm-circuit-breaker.service';

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
  selectedTools: AssistantToolName[];
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
    private readonly leafletReadService: AssistantToolLeafletReadService,
    private readonly metricsService: MetricsService,
    private readonly circuitBreaker: LlmCircuitBreakerService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly checkpointerService: AssistantCheckpointerService,
    private readonly conversationRepository: AssistantConversationRepositoryPort,
  ) {}

  hasChatModel(): boolean {
    return this.llmRuntimeService.hasRoleConfig('chat');
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
      enabledContextSources: AssistantContextSource[];
      /** Whether cross-conversation memory is enabled for this user. */
      memoryEnabled?: boolean;
      /** Whether this turn starts a new conversation. */
      isNewConversation?: boolean;
      /** Builds the persisted memory block (default: no memory injection). */
      buildMemoryBlock?: (userId: string) => Promise<string>;
      /**
       * Persisted conversation id used as the LangGraph thread id. When set
       * together with an available checkpointer, the turn runs with checkpoint
       * persistence and in-graph review; otherwise it stays stateless.
       */
      conversationId?: string;
    },
    executeTools: ToolExecutorFn,
    onChunk?: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): Promise<AssistantConversationResult> {
    const checkpointer = this.checkpointerService.getSaver();
    // HITL review (interrupt + confirm) only makes sense for a persisted
    // conversation; without `conversationId` the graph stays stateless and
    // never suspends, matching the degradation matrix.
    const enableHithl = input.conversationId != null && checkpointer != null;
    let streamedContent = false;
    const graph = buildAssistantRuntimeGraph({
      createModel: () =>
        this.llmRuntimeService.createChatModel('chat', CHAT_MODEL_OPTIONS),
      onText: async (content) => {
        streamedContent = true;
        await onChunk?.({ content });
      },
      executeTools,
      buildSystemPrompt: buildAssistantSystemPrompt,
      buildReadSystemPrompt,
      buildWriteSystemPrompt,
      buildKnowledgeSystemPrompt,
      buildSimpleChatSystemPrompt,
      ...(input.buildMemoryBlock != null
        ? { buildMemoryBlock: input.buildMemoryBlock }
        : {}),
      respondCache: this.respondCache,
      checkpointer: enableHithl ? checkpointer : null,
      ...(input.conversationId != null
        ? { conversationId: input.conversationId }
        : {}),
    });

    const config = enableHithl
      ? { configurable: { thread_id: input.conversationId } }
      : undefined;

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
          memoryEnabled: input.memoryEnabled ?? false,
          isNewConversation: input.isNewConversation ?? false,
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
   * pending proposals. Validates the review state (`getState`), then invokes
   * the graph with `Command({ resume })` so `write_review` writes the decision
   * back and `respond` produces the confirmation reply.
   */
  async resumeConversation(input: {
    userId: string;
    conversationId: string;
    decision: 'approved' | 'rejected';
    note?: string;
  }): Promise<{ finalContent: string | null }> {
    const graph = this.buildGraphWithCheckpointer(input.conversationId);
    const config = { configurable: { thread_id: input.conversationId } };

    const snapshot = await graph.getState(config);
    const pending = (
      snapshot.values as { pendingReview?: AssistantPendingReview }
    ).pendingReview;
    if (pending == null || pending.status !== 'pending') {
      badRequest('No pending proposal review for this conversation.');
    }
    // Expiry is validated per proposal by the confirm endpoint before the
    // thread is resumed (applyApprovedProposals), so no batch-level expiry
    // check exists here (F-11).

    const result = await graph.invoke(
      new Command({ resume: { decision: input.decision, note: input.note } }),
      config,
    );
    return { finalContent: result.finalContent ?? null };
  }

  /**
   * Reads the pending review and its proposals from the suspended thread's
   * checkpoint without resuming it. The confirm endpoint uses this to apply
   * approved writes server-side before the thread resumes.
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
    return {
      pendingReview: values.pendingReview ?? null,
      proposals: (values.toolResults ?? []).flatMap(
        (result) => result.proposedActions ?? [],
      ),
    };
  }

  /**
   * Streams a final response to the client, either by chunking pre-generated
   * content or by making a new streaming LLM call with tool context.
   */
  async generateStream(
    input: {
      locale: string;
      messages: AssistantConversationMessage[];
      allowedTools: readonly AssistantToolName[];
      toolResults: readonly AssistantToolExecutionResult[];
    },
    onChunk: (event: AssistantStreamChunkEvent) => void | Promise<void>,
  ): Promise<AssistantMessageResult> {
    const model = this.llmRuntimeService.createChatModel(
      'chat',
      CHAT_MODEL_OPTIONS,
    );
    const messages = this.buildMessages(
      input.messages,
      input.allowedTools,
      input.toolResults,
    );
    const start = performance.now();
    const modelName = this.llmRuntimeService.getModelName('chat') ?? 'unknown';
    let stream;
    this.circuitBreaker.acquire();
    try {
      stream = await withLlmRetry(() => model.stream(messages), {
        onRetry: (error, attempt) => {
          if (isRetryableLlmError(error)) {
            this.logger.warn(
              `Assistant stream retry #${String(attempt)}: ${(error as Error).message}`,
            );
          }
        },
      });
    } catch (error) {
      this.circuitBreaker.recordFailure();
      this.metricsService.recordLlmCall(
        'chat',
        modelName,
        'error',
        (performance.now() - start) / 1000,
      );
      throw error;
    }

    let content = '';

    try {
      for await (const chunk of stream) {
        if (!(chunk instanceof AIMessageChunk)) {
          continue;
        }

        const delta = this.readChunkText(chunk);
        if (delta.length === 0) {
          continue;
        }

        content += delta;
        await onChunk({ content: delta });
      }

      const finalContent = content.trim();
      if (finalContent.length === 0) {
        throw new Error(
          'Assistant stream ended without any assistant content.',
        );
      }

      this.circuitBreaker.recordSuccess();
      this.metricsService.recordLlmCall(
        'chat',
        modelName,
        'success',
        (performance.now() - start) / 1000,
      );
      return {
        content: finalContent,
        usedToolNames: input.toolResults.map((result) => result.name),
      };
    } catch (error) {
      this.circuitBreaker.recordFailure();
      this.metricsService.recordLlmCall(
        'chat',
        modelName,
        'error',
        (performance.now() - start) / 1000,
      );
      throw error;
    }
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
    const words = content.split(/(\s+)/);
    for (const word of words) {
      if (word.length > 0) {
        await onChunk({ content: word });
      }
    }

    return {
      content,
      usedToolNames: toolResults.map((result) => result.name),
    };
  }

  async describeFoundation(): Promise<AssistantRuntimeCapabilities> {
    const chatModelConfigured = this.hasChatModel();
    const hasChunks = await this.leafletReadService.hasIndexedChunks();
    return {
      phase: 'foundation',
      chatModelConfigured,
      interactiveChatReady: chatModelConfigured,
      langGraphReady: true,
      ragEnabled: chatModelConfigured && hasChunks,
      graphNodeNames: ASSISTANT_RUNTIME_NODE_NAMES,
      toolNames: ASSISTANT_TOOL_NAMES,
      implementedToolNames: ASSISTANT_IMPLEMENTED_TOOL_NAMES,
      contextSources: ASSISTANT_CONTEXT_SOURCES,
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
    const checkpointer = this.checkpointerService.getSaver();
    if (checkpointer == null) {
      badRequest(
        'Checkpoint persistence is unavailable; cannot resume the review.',
      );
    }

    return buildAssistantRuntimeGraph({
      createModel: () =>
        this.llmRuntimeService.createChatModel('chat', CHAT_MODEL_OPTIONS),
      // The resume/read path never reaches the agent↔tools loop; tools are
      // only executed by the original (now suspended) invocation.
      executeTools: () => Promise.resolve([]),
      buildSystemPrompt: buildAssistantSystemPrompt,
      buildReadSystemPrompt,
      buildWriteSystemPrompt,
      buildKnowledgeSystemPrompt,
      buildSimpleChatSystemPrompt,
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
   * within 30 seconds is rejected with 409.
   */
  async regenerateLastMessage(
    userId: string,
    conversationId: string,
  ): Promise<{ checkpointId: string; sourceMessageId: string }> {
    const conversation = await this.conversationRepository.findWithMessages(
      userId,
      conversationId,
    );
    if (conversation == null || conversation.status === 'deleted') {
      notFound('Conversation not found.');
    }

    const dbMessages = conversation.messages;
    const lastDbMessage = dbMessages.at(-1);
    if (lastDbMessage == null || lastDbMessage.role !== 'assistant') {
      badRequest('Only the last assistant message can be regenerated.');
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
      badRequest('Cannot read the conversation generation history.');
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
      badRequest('Cannot locate the generation state of the last message.');
    }
    const checkpointId =
      target.config.configurable == null
        ? undefined
        : (target.config.configurable['checkpoint_id'] as string | undefined);
    if (checkpointId == null) {
      badRequest('Cannot locate the generation state of the last message.');
    }

    const recent = await this.conversationRepository.findRecentRegeneration(
      conversationId,
      lastDbMessage.id,
    );
    if (recent != null) {
      conflict('A regeneration is already in progress for this message.');
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
        `Assistant regeneration produced no content (conversationId=${conversationId}, checkpointId=${checkpointId}).`,
        cause.stack,
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

  private buildMessages(
    messages: AssistantConversationMessage[],
    allowedTools: readonly AssistantToolName[],
    _toolResults: readonly AssistantToolExecutionResult[],
  ) {
    return [
      new SystemMessage(buildAssistantSystemPrompt(allowedTools)),
      ...messages.map((message) =>
        message.role === 'user'
          ? new HumanMessage(message.content)
          : new AIMessage(message.content),
      ),
    ];
  }

  private readChunkText(chunk: AIMessageChunk): string {
    if (typeof chunk.content === 'string') {
      return chunk.content;
    }

    if (!Array.isArray(chunk.content)) {
      return '';
    }

    return chunk.content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if ('text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('');
  }
}
