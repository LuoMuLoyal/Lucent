/**
 * Generate one surface (ADR-0024 application layer).
 *
 * Ordered guards, cheapest first:
 *
 * 1. **Request shape** — known, composable surface; usable prompt. Pure, no I/O.
 * 2. **Model availability** — refuse before opening a stream if no model is
 *    configured, so the client gets a clear 503 rather than an SSE stream that
 *    immediately errors.
 * 3. **Generate** — stream messages out as they arrive.
 * 4. **Admission** — check the whole produced sequence against
 *    `checkSurfaceProduction`. A violation fails the *entire* generation.
 *
 * ## Why the whole generation fails on one violation
 *
 * Dropping the offending component would mean guessing what the model meant.
 * For the worst class — a fabricated health number — the removal is the most
 * dangerous option: what remains looks like a complete, trustworthy surface.
 * Failing loudly keeps the last good surface on screen instead (the client
 * retains it by design).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import type { DomainFailure } from '../../../../common/result/index.js';
import {
  createDomainFailure,
  DomainFailureException,
} from '../../../../common/result/index.js';
import type {
  A2uiMessage,
  GeneratedSurface,
} from '../../domain/generative/generated-surface.js';
import {
  type GenerationRequest,
  toGenerativeSurface,
  validateGenerationRequest,
} from '../../domain/generative/generation-request.js';
import { checkSurfaceProduction } from '../../domain/generative/surface-policy.js';
import {
  SURFACE_GENERATOR,
  type SurfaceGenerator,
  type SurfaceGenerationContext,
} from '../ports/surface-generator.js';

/** Input to a generation request. */
export interface GenerateSurfaceInput extends GenerationRequest {
  readonly language: string;
}

/** Result of a successful generation. */
export type GenerateSurfaceResult = GeneratedSurface;

/**
 * How many violation kinds are named in the failure detail.
 *
 * The full list goes to the log; the wire detail stays short because it is a
 * diagnostic hint, not a report. A model that invents one number usually
 * invents several, so the count is capped rather than truncated arbitrarily.
 */
const VIOLATIONS_IN_DETAIL = 3;

/**
 * How many violations are attached to the log entry.
 *
 * Separate from {@link VIOLATIONS_IN_DETAIL}: the log is for diagnosis and can
 * afford more context than the wire detail, but a pathological tree could
 * produce dozens of them and flood the log line.
 */
const VIOLATIONS_LOGGED = 5;

@Injectable()
export class GenerateSurface {
  private readonly logger = new Logger(GenerateSurface.name);

  constructor(
    @Inject(SURFACE_GENERATOR)
    private readonly generator: SurfaceGenerator,
  ) {}

  /**
   * Runs the whole pipeline.
   *
   * `onMessage` streams each message as it is parsed, so the controller can
   * write `event: chunk` frames during generation. It must tolerate messages
   * that are later rejected by admission — the client keeps them in a staging
   * buffer and only applies the sequence on `event: result`.
   */
  async execute(
    input: GenerateSurfaceInput,
    onMessage: (message: A2uiMessage) => void | Promise<void>,
  ): Promise<GenerateSurfaceResult> {
    const shapeFailure = validateGenerationRequest(input);
    if (shapeFailure != null) throw asException(shapeFailure);

    const surface = toGenerativeSurface(input.surface);

    if (!this.generator.isConfigured()) {
      throw asException(
        createDomainFailure({
          kind: 'dependency',
          code: 'LLM_NOT_CONFIGURED',
        }),
      );
    }

    const context: SurfaceGenerationContext = {
      surface,
      prompt: input.prompt.trim(),
      language: input.language,
      ...(input.range == null ? {} : { range: input.range }),
    };

    const output = await this.generator.generateWithStream(context, onMessage);

    // 4. Admission. Runs on the complete sequence, not on the streamed frames:
    // a partially streamed tree can look valid while the next message adds the
    // violation.
    const violations = checkSurfaceProduction(output.messages);
    if (violations.length > 0) {
      this.logger.warn(
        {
          surface,
          violations: violations.slice(0, VIOLATIONS_LOGGED),
          violationCount: violations.length,
        },
        'Generated surface rejected by admission policy',
      );
      throw asException(
        createDomainFailure({
          kind: 'dependency',
          code: 'GENERATIVE_OUTPUT_REJECTED',
          detail: violations
            .slice(0, VIOLATIONS_IN_DETAIL)
            .map(
              (v) => `${v.kind}${v.componentType ? `:${v.componentType}` : ''}`,
            )
            .join(', '),
        }),
      );
    }

    return {
      surface,
      messages: output.messages,
      usage: {
        // Token counts come from the generator when available; the port keeps
        // them optional so a fake in tests does not have to invent numbers.
        promptTokens: readTokenCount(output, 'promptTokens'),
        completionTokens: readTokenCount(output, 'completionTokens'),
      },
    };
  }
}

/**
 * Wraps a domain failure in the exception the HTTP layer understands.
 *
 * Imported lazily to avoid a cycle between the application layer and the
 * adapter that owns `DomainFailureException`'s transport mapping — the
 * exception class itself lives in `common/result`, which the application layer
 * may use.
 */
function asException(failure: DomainFailure): DomainFailureException {
  return new DomainFailureException(failure);
}

function readTokenCount(output: Record<string, unknown>, key: string): number {
  const value = output[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}
