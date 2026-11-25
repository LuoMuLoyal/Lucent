/**
 * Continue one surface from an interaction round (ADR-0024 application layer).
 *
 * A v1.0 surface is **interactive**: the agent can emit a Button whose action
 * comes back to it, and an input whose value lands in the data model. This use
 * case is the server side of that loop.
 *
 * ## Stateless by design
 *
 * The server holds no session, so each round carries the whole document. That
 * costs a little bandwidth per interaction and buys three things:
 *
 * - a restart loses nothing that matters;
 * - a second device continues from its own copy without reconciliation;
 * - there is no expiry, eviction or cross-user session leak to reason about.
 *
 * ## Why the reply is a complete sequence
 *
 * The agent is asked to return the **whole** message sequence, not a diff. The
 * client applies `result` over the same surface, so a complete sequence is both
 * simpler to reason about and self-correcting after a dropped frame.
 *
 * The envelope check is the same one `/generate` uses — a turn produces a
 * surface just as a first pass does.
 */

import { Inject, Injectable } from '@nestjs/common';

import { createDomainFailure } from '../../../../common/result/index.js';
import {
  type SurfaceTurnRequest,
  toGenerativeSurface,
  validateTurnRequest,
} from '../../domain/generative/generation-request.js';
import type {
  A2uiMessage,
  GeneratedSurface,
} from '../../domain/generative/generated-surface.js';
import type {
  SurfaceGenerator,
  SurfaceTurnContext,
} from '../ports/surface-generator.js';
import { SURFACE_GENERATOR } from '../ports/surface-generator.js';
import { asException, GenerateSurface } from './generate-surface.js';

/** Input to a continuation round. */
export interface ContinueSurfaceInput extends SurfaceTurnRequest {
  readonly language: string;
}

/** Result of a continuation round. */
export type ContinueSurfaceResult = GeneratedSurface;

@Injectable()
export class ContinueSurface {
  constructor(
    @Inject(SURFACE_GENERATOR)
    private readonly generator: SurfaceGenerator,
    /**
     * Reused only for its envelope check: a turn's product is a surface, and the
     * rules for "is this a valid v1.0 surface" must not be written twice.
     */
    private readonly generateSurface: GenerateSurface,
  ) {}

  async execute(
    input: ContinueSurfaceInput,
    onMessage: (message: A2uiMessage) => void | Promise<void>,
  ): Promise<ContinueSurfaceResult> {
    const shapeFailure = validateTurnRequest(input);
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

    const context: SurfaceTurnContext = {
      surface,
      messages: input.messages,
      document: input.document,
      language: input.language,
      ...(input.capabilities == null
        ? {}
        : { capabilities: input.capabilities }),
    };

    const output = await this.generator.continueWithStream(context, onMessage);

    this.generateSurface.assertWellFormed(output.messages, surface);

    return {
      surface,
      messages: output.messages,
      usage: {
        promptTokens: readTokenCount(output, 'promptTokens'),
        completionTokens: readTokenCount(output, 'completionTokens'),
      },
    };
  }
}

function readTokenCount(output: Record<string, unknown>, key: string): number {
  const value = output[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}
