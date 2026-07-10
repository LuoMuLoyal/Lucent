import { Injectable, Logger } from '@nestjs/common';
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { LlmRuntimeService } from '../../../llm-runtime/services/llm-runtime.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import type { AssistantRuntimeCapabilities } from '../types/types';
import type {
  AssistantMessageResult,
  AssistantConversationMessage,
  AssistantStreamChunkEvent,
  AssistantToolExecutionResult,
} from '../types/types';
import {
  ASSISTANT_CONTEXT_SOURCES,
  ASSISTANT_IMPLEMENTED_TOOL_NAMES,
  ASSISTANT_TOOL_NAMES,
} from '../tools/types';
import type { AssistantContextSource, AssistantToolName } from '../tools/types';
import { AI_MODEL_TIMEOUT_MS } from '../../../config/constants';
import { AssistantToolLeafletReadService } from '../tools/leaflet/read.service';
import { buildAssistantSystemPrompt } from '../prompts/system.prompt';
import {
  ASSISTANT_RUNTIME_NODE_NAMES,
  selectAllowedToolsForContextSources,
  selectRelevantToolsForMessage,
  type AssistantRuntimeState,
  buildAssistantRuntimeGraph,
  type ToolExecutorFn,
} from './runtime';
import {
  withLlmRetry,
  isRetryableLlmError,
} from '../../../common/llm/llm-retry.helper';

const CHAT_MODEL_OPTIONS = {
  timeout: AI_MODEL_TIMEOUT_MS,
  temperature: 0.2,
  maxRetries: 0, // retries handled by withLlmRetry
} as const;

/** Result of running the conversation tool-loop graph. */
export interface AssistantConversationResult {
  toolResults: AssistantToolExecutionResult[];
  finalContent: string | null;
  selectedTools: AssistantToolName[];
  stopReason: 'answered' | 'no_match' | 'tool_cap_reached' | null;
}

@Injectable()
export class AssistantRuntimeService {
  private readonly logger = new Logger(AssistantRuntimeService.name);

  constructor(
    private readonly llmRuntimeService: LlmRuntimeService,
    private readonly leafletReadService: AssistantToolLeafletReadService,
    private readonly metricsService: MetricsService,
  ) {}

  hasChatModel(): boolean {
    return this.llmRuntimeService.hasRoleConfig('chat');
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
    },
    executeTools: ToolExecutorFn,
  ): Promise<AssistantConversationResult> {
    const graph = buildAssistantRuntimeGraph({
      createModel: () =>
        this.llmRuntimeService.createChatModel('chat', CHAT_MODEL_OPTIONS),
      executeTools,
      buildSystemPrompt: buildAssistantSystemPrompt,
    });

    const result = await graph.invoke({
      userId: input.userId,
      userMessage: input.userMessage,
      locale: input.locale,
      enabledContextSources: input.enabledContextSources,
    });

    return {
      toolResults: result.toolResults,
      finalContent: result.finalContent,
      selectedTools: result.selectedTools,
      stopReason: result.stopReason,
    };
  }

  /**
   * Legacy plan-only method (keyword-based, no LLM call).
   * Kept for backward compatibility and tests.
   */
  planConversation(input: {
    userId: string;
    userMessage: string;
    locale: string;
    enabledContextSources: AssistantContextSource[];
  }): Promise<AssistantRuntimeState> {
    const allowedTools = selectAllowedToolsForContextSources(
      input.enabledContextSources,
    );
    const selectedTools = selectRelevantToolsForMessage(
      input.userMessage,
      allowedTools,
    );
    return Promise.resolve({
      userId: input.userId,
      userMessage: input.userMessage,
      locale: input.locale,
      enabledContextSources: input.enabledContextSources,
      allowedTools,
      messages: [],
      pendingToolCalls: [],
      toolResults: [],
      loopCount: Math.min(3, selectedTools.length > 0 ? 1 : 0),
      finalContent: null,
      selectedTools,
      retrievalEvidence: selectedTools,
      stopReason: selectedTools.length > 0 ? 'answered' : 'no_match',
      route: 'respond',
    } as unknown as AssistantRuntimeState);
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
        this.metricsService.recordLlmCall(
          'chat',
          modelName,
          'error',
          (performance.now() - start) / 1000,
        );
        throw new Error(
          'Assistant stream ended without any assistant content.',
        );
      }

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
