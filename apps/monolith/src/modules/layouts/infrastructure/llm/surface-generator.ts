import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import type {
  SurfaceGenerator,
  SurfaceGenerationContext,
  SurfaceGenerationOutput,
  SurfaceTurnContext,
} from '../../application/ports/surface-generator.js';
import type { A2uiMessage } from '../../domain/generative/generated-surface.js';
import {
  surfaceGenerationSchema,
  type SurfaceGenerationStructuredOutput,
} from './schemas/surface.js';
import {
  buildSurfaceSystemPrompt,
  buildSurfaceTurnUserPrompt,
  buildSurfaceUserPrompt,
  type SurfacePromptCopy,
} from './prompts/surface.js';

/**
 * LangChain-backed surface generator.
 *
 * All of the resilience (retry, circuit breaker, metrics, OTel span) comes from
 * `BaseLlmGeneratorService`; this class only supplies prompts and the schema.
 *
 * ## How messages are streamed out
 *
 * The base class parses partial output on every chunk. `messages` is an array,
 * so a partial parse yields *some* complete elements followed by one element
 * still being written. We forward only the complete prefix — tracked by length
 * — which is exactly the granularity the controller needs for `event: chunk`.
 *
 * Re-sending or skipping an element would desync the client's replay buffer,
 * hence the strict `index >= forwarded` check rather than "emit the last one".
 */
@Injectable()
export class LlmSurfaceGenerator
  extends BaseLlmGeneratorService<
    SurfaceGenerationContext,
    SurfacePromptCopy,
    SurfaceGenerationStructuredOutput
  >
  implements SurfaceGenerator
{
  protected readonly schema = surfaceGenerationSchema;
  protected readonly modelRole = 'analysis';
  protected readonly options = {
    toolName: 'ComposeSurface',
    streamName: 'Generative surface',
  } as const;

  /**
   * The context the current call was made with.
   *
   * `buildSystemPrompt` gets no arguments, but the vocabulary it renders comes
   * from the client's capabilities document — which is per-request. Set on each
   * entry point; reading it is safe because one instance serves one call at a
   * time per invocation (the base class awaits the stream to completion).
   */
  private capabilities: SurfaceGenerationContext['capabilities'];

  /** See `SurfaceGenerationContext.catalogId`. */
  private catalogId: string | undefined;

  public constructor(
    llmRuntimeService: LlmRuntimeService,
    metricsService: MetricsService,
    circuitBreaker: LlmCircuitBreakerService,
  ) {
    super(llmRuntimeService, metricsService, circuitBreaker);
  }

  isConfigured(): boolean {
    return this.hasAnalysisModel();
  }

  async generateWithStream(
    context: SurfaceGenerationContext,
    onMessage: (message: A2uiMessage) => void | Promise<void>,
  ): Promise<SurfaceGenerationOutput> {
    this.capabilities = context.capabilities;
    this.catalogId = context.catalogId;
    try {
      return await this.runStream(context, {}, onMessage);
    } finally {
      this.capabilities = undefined;
      this.catalogId = undefined;
    }
  }

  async continueWithStream(
    context: SurfaceTurnContext,
    onMessage: (message: A2uiMessage) => void | Promise<void>,
  ): Promise<SurfaceGenerationOutput> {
    this.capabilities = context.capabilities;
    this.catalogId = context.catalogId;
    try {
      // The base class is generic over one context type; a turn is passed as a
      // generation context because the two share every field the streaming
      // machinery reads (prompt copy is empty, messages come from the schema).
      // `buildUserPrompt` below branches on the extra turn fields.
      const turnContext = context as unknown as SurfaceGenerationContext;
      return await this.runStream(turnContext, {}, onMessage);
    } finally {
      this.capabilities = undefined;
      this.catalogId = undefined;
    }
  }

  /** Shared streaming body: forwards each newly complete message. */
  private async runStream(
    context: SurfaceGenerationContext,
    copy: SurfacePromptCopy,
    onMessage: (message: A2uiMessage) => void | Promise<void>,
  ): Promise<SurfaceGenerationOutput> {
    // Every already-forwarded element is tracked by index: a partial parse can
    // only ever extend the array, so remembering the count is enough to emit
    // each element exactly once.
    let forwarded = 0;

    const output = await super.generateStream(
      context,
      copy,
      // `summary` is progress metadata only; the surface is the product.
      () => {},
      async (partial) => {
        const messages = partial.messages;
        if (!Array.isArray(messages)) return;

        for (let index = forwarded; index < messages.length; index += 1) {
          const message = messages[index];
          if (!isCompleteMessage(message)) break;
          forwarded = index + 1;
          await onMessage(message);
        }
      },
    );

    return {
      summary: output.summary,
      messages: output.messages,
    };
  }

  protected buildSystemPrompt(): string {
    // The vocabulary comes from the client's advertised catalog. It is not
    // routed through the runtime prompt override for that reason: the override
    // is server config, and the catalog is client state.
    return buildSurfaceSystemPrompt(this.capabilities, this.catalogId);
  }

  protected buildUserPrompt(
    context: SurfaceGenerationContext,
    _copy: SurfacePromptCopy,
  ): string {
    return isTurnContext(context)
      ? buildSurfaceTurnUserPrompt(context)
      : buildSurfaceUserPrompt(context);
  }
}

/** Whether the context is a continuation round. */
function isTurnContext(
  context: SurfaceGenerationContext,
): context is SurfaceGenerationContext & SurfaceTurnContext {
  return 'document' in context && 'messages' in context;
}

/**
 * Whether a streamed array element looks finished.
 *
 * A partially parsed A2UI message can appear as an object that already has a
 * `version` but not yet the body key, so both are required. Forwarding an
 * incomplete element would make the client render a surface that then changes
 * shape mid-stream.
 */
function isCompleteMessage(value: unknown): value is A2uiMessage {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['version'] === 'string' &&
    ('createSurface' in record ||
      'updateComponents' in record ||
      'updateDataModel' in record ||
      'deleteSurface' in record ||
      'callRendererFunction' in record ||
      'agentFunctionResponse' in record)
  );
}
