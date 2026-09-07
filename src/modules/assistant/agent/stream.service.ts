import { Injectable, Logger } from '@nestjs/common';
import { AIMessageChunk } from '@langchain/core/messages';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { LlmRuntimeService } from '../../../llm-runtime/index.js';
import { MetricsService } from '../../../common/metrics/metrics.service.js';
import { LlmCircuitBreakerService } from '../../../common/llm/safety/llm-circuit-breaker.service.js';
import {
  withLlmRetry,
  isRetryableLlmError,
} from '../../../common/llm/retry/llm-retry.helper.js';
import { AI_MODEL_TIMEOUT_MS } from '../../../config/app-defaults.constants.js';
import { buildAssistantSystemPrompt } from '../prompts/system.prompt.js';
import type { AssistantToolName } from '../tools/shared/tool-types.js';
import type {
  AssistantConversationMessage,
  AssistantMessageResult,
  AssistantStreamChunkEvent,
  AssistantToolExecutionResult,
} from '../types/assistant.types.js';

const CHAT_MODEL_OPTIONS = {
  timeout: AI_MODEL_TIMEOUT_MS,
  temperature: 0.2,
  maxRetries: 0, // retries handled by withLlmRetry
} as const;

/**
 * LLM streaming for assistant replies: streams a fresh model response with
 * tool context, or replays pre-generated content as word-level chunks.
 *
 * Extracted from `AssistantRuntimeService` so graph orchestration and
 * LLM-stream mechanics live in separate files.
 */
@Injectable()
export class AssistantStreamService {
  private readonly logger = new Logger(AssistantStreamService.name);

  constructor(
    private readonly llmRuntimeService: LlmRuntimeService,
    private readonly metricsService: MetricsService,
    private readonly circuitBreaker: LlmCircuitBreakerService,
  ) {}

  /**
   * Streams a final response to the client by making a streaming LLM call
   * with tool context. (The graph's own agent-node output is streamed by
   * {@link streamPreGeneratedContent} instead.)
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
        // eslint-disable-next-line error-handling/no-bare-throw-error -- empty stream is an LLM runtime anomaly, surfaced as-is to the stream orchestrator
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
