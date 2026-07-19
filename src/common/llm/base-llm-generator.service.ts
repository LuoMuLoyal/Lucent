import { Injectable, Logger } from '@nestjs/common';
import {
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { JsonOutputKeyToolsParser } from '@langchain/core/output_parsers/openai_tools';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import type { ZodObject, ZodType } from 'zod';
import type { LlmRole, LlmRuntimePort } from './llm-runtime.port';
import { AI_MODEL_TIMEOUT_MS } from '../../config/constants';
import { withLlmRetry, isRetryableLlmError } from './llm-retry.helper';
import { LlmCircuitBreakerService } from './llm-circuit-breaker.service';
import { MetricsService } from '../metrics/metrics.service';

const MODEL_OPTIONS = {
  timeout: AI_MODEL_TIMEOUT_MS,
  temperature: 0.2,
  maxRetries: 0, // retries handled by withLlmRetry for finer control
} as const;

export interface BaseLlmGeneratorOptions {
  /** Name passed to the model as the function/tool name. */
  toolName: string;
  /** Human-readable name used in stream error messages. */
  streamName: string;
}

/**
 * Shared base for LLM structured-output generators.
 *
 * Subclasses only need to supply the Zod schema, tool name, and prompt builders;
 * streaming and structured-output invocation are implemented once here.
 */
@Injectable()
export abstract class BaseLlmGeneratorService<
  TContext,
  TPromptCopy,
  TOutput extends Record<string, unknown>,
> {
  protected abstract readonly schema: ZodType<TOutput>;
  protected abstract readonly options: BaseLlmGeneratorOptions;
  /** LLM model role to use (e.g. 'analysis', 'language'). */
  protected abstract readonly modelRole: LlmRole;

  private readonly logger = new Logger(BaseLlmGeneratorService.name);

  protected constructor(
    private readonly llmRuntimeService: LlmRuntimePort,
    private readonly metricsService: MetricsService,
    private readonly circuitBreaker: LlmCircuitBreakerService,
  ) {}

  hasAnalysisModel(): boolean {
    return this.llmRuntimeService.hasRoleConfig(this.modelRole);
  }

  async generate(context: TContext, promptCopy: TPromptCopy): Promise<TOutput> {
    const model = this.createStructuredOutputModel();
    const messages = this.buildMessages(context, promptCopy);
    const start = performance.now();
    const modelName =
      this.llmRuntimeService.getModelName(this.modelRole) ?? 'unknown';

    try {
      this.circuitBreaker.acquire();
      const result = await withLlmRetry(
        () => model.invoke(messages) as Promise<TOutput>,
        {
          onRetry: (error, attempt) => {
            if (isRetryableLlmError(error)) {
              this.logger.warn(
                `${this.options.streamName} generate retry #${String(attempt)}: ${(error as Error).message}`,
              );
            }
          },
        },
      );
      this.circuitBreaker.recordSuccess();
      this.metricsService.recordLlmCall(
        this.modelRole,
        modelName,
        'success',
        (performance.now() - start) / 1000,
      );
      return result;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      this.metricsService.recordLlmCall(
        this.modelRole,
        modelName,
        'error',
        (performance.now() - start) / 1000,
      );
      throw error;
    }
  }

  async generateStream(
    context: TContext,
    promptCopy: TPromptCopy,
    onSummary: (summary: string) => void | Promise<void>,
  ): Promise<TOutput> {
    const model = this.createStreamingModel();
    const parser = new JsonOutputKeyToolsParser<TOutput>({
      keyName: this.options.toolName,
      returnSingle: true,
      zodSchema: this.schema as never,
    });
    const start = performance.now();
    const modelName =
      this.llmRuntimeService.getModelName(this.modelRole) ?? 'unknown';

    let stream: AsyncIterable<AIMessageChunk>;

    // Acquire outside the try block so that an `LlmCircuitOpenError` thrown
    // by `acquire()` does not trigger `recordFailure()` (which would be a
    // no-op once fix-3 is applied, but is clearer this way).
    this.circuitBreaker.acquire();
    try {
      stream = await withLlmRetry(
        () => model.stream(this.buildMessages(context, promptCopy)),
        {
          onRetry: (error, attempt) => {
            if (isRetryableLlmError(error)) {
              this.logger.warn(
                `${this.options.streamName} stream retry #${String(attempt)}: ${(error as Error).message}`,
              );
            }
          },
        },
      );
    } catch (error) {
      this.circuitBreaker.recordFailure();
      this.metricsService.recordLlmCall(
        this.modelRole,
        modelName,
        'error',
        (performance.now() - start) / 1000,
      );
      throw error;
    }

    let accumulated: AIMessageChunk | undefined;
    let lastSummary = '';

    // Wrap the entire stream-processing phase so that stream-level failures
    // (empty stream, JSON/schema parse errors, mid-stream network drops) are
    // reported to the circuit breaker via `recordFailure()`. `recordSuccess()`
    // is deferred until the full result is validated, so a "half-available"
    // provider that connects but returns garbage will still trip the breaker.
    try {
      for await (const chunk of stream) {
        if (!(chunk instanceof AIMessageChunk)) {
          continue;
        }

        accumulated =
          accumulated === undefined ? chunk : accumulated.concat(chunk);
        const partial = (await parser.parsePartialResult([
          this.toGenerationChunk(accumulated),
        ])) as unknown; // parsePartialResult returns a partial that doesn't conform to the full schema
        const summary = this.readSummary(partial);

        if (summary.trim().length > 0 && summary !== lastSummary) {
          lastSummary = summary;
          await onSummary(summary);
        }
      }

      if (accumulated === undefined) {
        throw new Error(
          `${this.options.streamName} stream ended without any message chunks.`,
        );
      }

      const result = (await parser.parseResult([
        this.toGenerationChunk(accumulated),
      ])) as unknown; // narrowed by this.schema.parse(result) below
      if (result == null) {
        throw new Error(
          `${this.options.streamName} stream ended without a structured result.`,
        );
      }

      const parsed = this.schema.parse(result);
      this.circuitBreaker.recordSuccess();
      this.metricsService.recordLlmCall(
        this.modelRole,
        modelName,
        'success',
        (performance.now() - start) / 1000,
      );
      return parsed;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      this.metricsService.recordLlmCall(
        this.modelRole,
        modelName,
        'error',
        (performance.now() - start) / 1000,
      );
      throw error;
    }
  }

  protected abstract buildSystemPrompt(): string;
  protected abstract buildUserPrompt(
    context: TContext,
    promptCopy: TPromptCopy,
  ): string;

  private buildMessages(context: TContext, promptCopy: TPromptCopy) {
    return [
      new SystemMessage(this.buildSystemPrompt()),
      new HumanMessage(this.buildUserPrompt(context, promptCopy)),
    ];
  }

  private createStructuredOutputModel() {
    return this.llmRuntimeService
      .createChatModel(this.modelRole, MODEL_OPTIONS)
      .withStructuredOutput(this.schema, {
        name: this.options.toolName,
        method: 'functionCalling',
        strict: true,
      });
  }

  private createStreamingModel() {
    const schema = toJsonSchema(this.schema);

    return this.llmRuntimeService
      .createChatModel(this.modelRole, MODEL_OPTIONS)
      .withConfig({
        outputVersion: 'v0',
        tools: [
          {
            type: 'function',
            function: {
              name: this.options.toolName,
              description:
                typeof schema.description === 'string'
                  ? schema.description
                  : '',
              parameters: schema,
            },
          },
        ],
        tool_choice: {
          type: 'function',
          function: { name: this.options.toolName },
        },
        strict: true,
      });
  }

  private toGenerationChunk(message: AIMessageChunk): ChatGenerationChunk {
    return new ChatGenerationChunk({
      message,
      text: typeof message.content === 'string' ? message.content : '',
    });
  }

  private readSummary(partial: unknown): string {
    if (partial == null || typeof partial !== 'object') {
      return '';
    }

    const parsed = (this.schema as ZodObject<Record<string, ZodType>>)
      .partial()
      .safeParse(partial);
    if (!parsed.success) {
      return '';
    }

    const summary = parsed.data['summary'];
    return typeof summary === 'string' ? summary : '';
  }
}
