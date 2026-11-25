/**
 * Generate one surface (ADR-0024 application layer).
 *
 * Ordered guards, cheapest first:
 *
 * 1. **Request shape** — known, composable surface; usable prompt; bounded
 *    capabilities document. Pure, no I/O.
 * 2. **Model availability** — refuse before opening a stream if no model is
 *    configured, so the client gets a clear 503 rather than an SSE stream that
 *    immediately errors.
 * 3. **Generate** — stream messages out as they arrive.
 * 4. **Envelope check** — verify the produced sequence is well-formed A2UI v1.0.
 *
 * ## What changed with A2UI 1.0
 *
 * Step 4 used to enforce a content policy (`surface-policy.ts`): no numbers, no
 * writable actions, findings by id. That whole rule set is gone — the client's
 * catalog is full, the client advertises it, and a Button the agent emits is a
 * Button the user is meant to press. What remains is structural: every message
 * must be a v1.0 envelope, and the sequence must build a surface with a root.
 *
 * A violated envelope still fails the **entire** generation rather than dropping
 * the offending message: a half-parsed tree with a missing root renders as an
 * empty page, which looks like a successful generation that produced nothing.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { DomainFailure } from '../../../../common/result/index.js';
import {
  createDomainFailure,
  DomainFailureException,
} from '../../../../common/result/index.js';
import type { GenerativeSurfaceConfig } from '../../../../config/services/generative-surface.config.js';
import { ConfigKey } from '../../../../config/env/config-keys.enum.js';
import { checkSurfaceProduction } from '../../domain/generative/a2ui-envelope.js';
import type {
  A2uiMessage,
  GeneratedSurface,
} from '../../domain/generative/generated-surface.js';
import {
  type GenerationRequest,
  toGenerativeSurface,
  validateGenerationRequest,
} from '../../domain/generative/generation-request.js';
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
 * diagnostic hint, not a report.
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
    /**
     * Source of `A2UI_CATALOG_ID`. Injected rather than read from `process.env`
     * so tests and forks can override it the same way as any other setting.
     */
    private readonly configService: ConfigService,
  ) {}

  /**
   * Catalog id the model should use, from deployment config.
   *
   * Empty is a valid state: a deployment that publishes no catalog gets a prompt
   * naming none, rather than one asserting an identifier it never chose.
   */
  get catalogId(): string {
    return (
      this.configService.get<GenerativeSurfaceConfig>(
        ConfigKey.GenerativeSurface,
      )?.catalogId ?? ''
    );
  }

  /**
   * Runs the whole pipeline.
   *
   * `onMessage` streams each message as it is parsed, so the controller can
   * write `event: chunk` frames during generation. It must tolerate messages
   * that are later rejected by the envelope check — the client keeps them in a
   * staging buffer and only applies the sequence on `event: result`.
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
      ...(input.capabilities == null
        ? {}
        : { capabilities: input.capabilities }),
      ...(this.catalogId.length === 0 ? {} : { catalogId: this.catalogId }),
    };

    const output = await this.generator.generateWithStream(context, onMessage);

    // 4. Envelope check. Runs on the complete sequence, not on the streamed
    // frames: a partially streamed tree can look valid while the next message
    // breaks it.
    this.assertWellFormed(output.messages, surface);

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

  /** Fails the generation when the produced sequence is not valid v1.0. */
  assertWellFormed(messages: readonly A2uiMessage[], surface: string): void {
    const violations = checkSurfaceProduction(messages);
    if (violations.length === 0) return;

    this.logger.warn(
      {
        surface,
        violations: violations.slice(0, VIOLATIONS_LOGGED),
        violationCount: violations.length,
      },
      'Generated surface rejected by envelope check',
    );
    throw asException(
      createDomainFailure({
        kind: 'dependency',
        code: 'GENERATIVE_OUTPUT_REJECTED',
        detail: violations
          .slice(0, VIOLATIONS_IN_DETAIL)
          .map((v) =>
            v.index == null ? v.kind : `${v.kind}@${String(v.index)}`,
          )
          .join(', '),
      }),
    );
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
export function asException(failure: DomainFailure): DomainFailureException {
  return new DomainFailureException(failure);
}

function readTokenCount(output: Record<string, unknown>, key: string): number {
  const value = output[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}
