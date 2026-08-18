import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
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

const llmTracer = trace.getTracer('lucent-llm');

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

  /**
   * Invoke the structured-output model inside a manual OTel span
   * (`llm.{streamName}.generate`) carrying `llm.model_role` / `llm.model_name`
   * attributes. Success sets the span to OK; failures record the exception and
   * mark the span ERROR before re-throwing.
   */
  async generate(context: TContext, promptCopy: TPromptCopy): Promise<TOutput> {
    return llmTracer.startActiveSpan(
      `llm.${this.options.streamName}.generate`,
      async (span) => {
        span.setAttribute('llm.model_role', this.modelRole);
        span.setAttribute(
          'llm.model_name',
          this.llmRuntimeService.getModelName(this.modelRole) ?? 'unknown',
        );
        try {
          const result = await this.runGenerate(context, promptCopy);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          // Preserve the original exception if it is already a NestJS HTTP
          // exception (e.g. LlmCircuitOpenError, which extends
          // ServiceUnavailableException) so callers can distinguish circuit
          // breaker rejections from genuine generation failures.
          if (error instanceof ServiceUnavailableException) {
            throw error;
          }
          throw new ServiceUnavailableException(
            `LLM generate failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          span.end();
        }
      },
    );
  }

  private async runGenerate(
    context: TContext,
    promptCopy: TPromptCopy,
  ): Promise<TOutput> {
    const model = this.createStructuredOutputModel();
    const messages = this.buildMessages(context, promptCopy);
    const start = performance.now();
    const modelName =
      this.llmRuntimeService.getModelName(this.modelRole) ?? 'unknown';

    // Acquire outside the try block so that an `LlmCircuitOpenError` thrown
    // by `acquire()` does not trigger `recordFailure()`, which would corrupt
    // the half-open probe counter and prematurely trip the breaker.
    this.circuitBreaker.acquire();
    try {
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
      // Structured success log: nest-winston's WinstonLogger destructures the
      // `message`/`level` keys out of an object message and merges the rest as
      // metadata, so otelTraceFormat injects top-level trace_id/span_id.
      this.logger.log({
        message: `${this.options.streamName} generate ok`,
        modelName,
        durationMs: Math.round(performance.now() - start),
        status: 'success',
      });
      return result;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      this.metricsService.recordLlmCall(
        this.modelRole,
        modelName,
        'error',
        (performance.now() - start) / 1000,
      );
      throw new ServiceUnavailableException(
        `LLM generate failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Streaming path intentionally unwrapped for now; manual span comes in a later change.
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

    // Track the most recent stream reference so we can attempt cleanup if
    // withLlmRetry ultimately fails. Each retry call to model.stream()
    // may establish an HTTP connection; if the overall retry sequence
    // throws, we try to close the last obtained stream to avoid leaking
    // the underlying connection.
    let lastStream: AsyncIterable<AIMessageChunk> | undefined;

    // Acquire outside the try block so that an `LlmCircuitOpenError` thrown
    // by `acquire()` does not trigger `recordFailure()` (which would be a
    // no-op once fix-3 is applied, but is clearer this way).
    this.circuitBreaker.acquire();
    try {
      stream = await withLlmRetry(
        async () => {
          const s = await model.stream(this.buildMessages(context, promptCopy));
          lastStream = s;
          return s;
        },
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
      // Best-effort cleanup of any stream created during a failed retry.
      // LangChain streams are typically AsyncGenerators; calling return()
      // triggers their cleanup logic and releases the underlying HTTP
      // connection.
      if (lastStream != null) {
        const maybeReturn = (
          lastStream as {
            return?: (...args: unknown[]) => Promise<unknown>;
          }
        ).return;
        if (typeof maybeReturn === 'function') {
          try {
            await maybeReturn.call(lastStream, undefined);
          } catch {
            // best-effort — ignore cleanup errors
          }
        }
      }
      this.circuitBreaker.recordFailure();
      this.metricsService.recordLlmCall(
        this.modelRole,
        modelName,
        'error',
        (performance.now() - start) / 1000,
      );
      throw new ServiceUnavailableException(
        `LLM stream acquire failed: ${error instanceof Error ? error.message : String(error)}`,
      );
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
        throw new ServiceUnavailableException(
          `${this.options.streamName} stream ended without any message chunks.`,
        );
      }

      const result = (await parser.parseResult([
        this.toGenerationChunk(accumulated),
      ])) as unknown; // narrowed by this.schema.parse(result) below
      if (result == null) {
        throw new ServiceUnavailableException(
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
      throw new ServiceUnavailableException(
        `LLM stream failed: ${error instanceof Error ? error.message : String(error)}`,
      );
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
