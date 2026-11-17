/**
 * Surface generator port (ADR-0024 application layer).
 *
 * The application layer depends on this interface, never on the LangChain
 * implementation — that is what keeps prompts, retries and the circuit breaker
 * swappable and the use case unit-testable with a fake generator.
 */

import type { GenerativeSurface } from '../../domain/generative/generation-request.js';
import type { A2uiMessage } from '../../domain/generative/generated-surface.js';

/** Everything the model needs to compose one surface. */
export interface SurfaceGenerationContext {
  readonly surface: GenerativeSurface;
  /** The user's instruction, already trimmed. */
  readonly prompt: string;
  /** Client language, normalised to a supported content locale. */
  readonly language: string;
  readonly range?: string;
}

/** Structured output the model must produce. */
export interface SurfaceGenerationOutput extends Record<string, unknown> {
  readonly summary: string;
  readonly messages: A2uiMessage[];
}

/**
 * Generates a surface, reporting each message as soon as it is complete.
 *
 * `onMessage` is called incrementally so the controller can forward `chunk`
 * events while the model is still writing. The final value is the validated
 * output; a parse failure surfaces as a thrown error, not a partial result.
 */
export interface SurfaceGenerator {
  /** Whether a model is configured for this role. */
  isConfigured(): boolean;

  /**
   * Named generateWithStream rather than generate so it cannot collide with
   * the inherited generate(context, copy) on the base generator class.
   */
  generateWithStream(
    context: SurfaceGenerationContext,
    onMessage: (message: A2uiMessage) => void | Promise<void>,
  ): Promise<SurfaceGenerationOutput>;
}

/** DI token for {@link SurfaceGenerator}. */
export const SURFACE_GENERATOR = Symbol('SURFACE_GENERATOR');
