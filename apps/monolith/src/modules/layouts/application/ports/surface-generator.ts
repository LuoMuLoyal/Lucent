/**
 * Surface generator port (ADR-0024 application layer).
 *
 * The application layer depends on this interface, never on the LangChain
 * implementation — that is what keeps prompts, retries and the circuit breaker
 * swappable and the use case unit-testable with a fake generator.
 */

import type {
  GenerativeSurface,
  SurfaceCapabilities,
  SurfaceDocument,
} from '../../domain/generative/generation-request.js';
import type { A2uiMessage } from '../../domain/generative/generated-surface.js';

/** Everything the model needs to compose one surface. */
export interface SurfaceGenerationContext {
  readonly surface: GenerativeSurface;
  /** The user's instruction, already trimmed. */
  readonly prompt: string;
  /** Client language, normalised to a supported content locale. */
  readonly language: string;
  readonly range?: string;
  /**
   * The client's catalog document.
   *
   * The prompt's component vocabulary is generated from this, so the model can
   * only name components the client actually registered — and there is exactly
   * one copy of that list across both repositories.
   */
  readonly capabilities?: SurfaceCapabilities;
}

/**
 * A continuation round.
 *
 * Carries the renderer's outbound messages and the document they act on, so the
 * model rewrites the same surface rather than composing a new one.
 */
export interface SurfaceTurnContext {
  readonly surface: GenerativeSurface;
  /** Renderer-to-agent messages, already validated for shape. */
  readonly messages: readonly Record<string, unknown>[];
  /** The document those messages belong to. */
  readonly document: SurfaceDocument;
  readonly language: string;
  readonly capabilities?: SurfaceCapabilities;
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

  /**
   * Continues an existing surface from one interaction round.
   *
   * Shares the streaming contract with {@link generateWithStream}: the client
   * applies `result` over the same surface, so a turn is just another write.
   */
  continueWithStream(
    context: SurfaceTurnContext,
    onMessage: (message: A2uiMessage) => void | Promise<void>,
  ): Promise<SurfaceGenerationOutput>;
}

/** DI token for {@link SurfaceGenerator}. */
export const SURFACE_GENERATOR = Symbol('SURFACE_GENERATOR');
