import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import type {
  SurfaceGenerator,
  SurfaceGenerationContext,
  SurfaceGenerationOutput,
} from '../../application/ports/surface-generator.js';
import type { A2uiMessage } from '../../domain/generative/generated-surface.js';
import {
  surfaceGenerationSchema,
  type SurfaceGenerationStructuredOutput,
} from './schemas/surface.js';
import {
  buildSurfaceSystemPrompt,
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
    // Every already-forwarded element is tracked by index: a partial parse can
    // only ever extend the array, so remembering the count is enough to emit
    // each element exactly once.
    let forwarded = 0;

    const output = await super.generateStream(
      context,
      {},
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
    // Deliberately not routed through the runtime prompt override: the
    // component vocabulary here must match the client catalog exactly, so
    // it is not something the config centre may tune.
    return buildSurfaceSystemPrompt();
  }

  protected buildUserPrompt(
    context: SurfaceGenerationContext,
    _copy: SurfacePromptCopy,
  ): string {
    return buildSurfaceUserPrompt(context);
  }
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
      'deleteSurface' in record)
  );
}
