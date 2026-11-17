import { z } from 'zod';

/**
 * Structured output of the surface generator.
 *
 * `summary` exists only because `BaseLlmGeneratorService` reads it to report
 * stream progress — it is not shown to the user and never leaves the server.
 * `messages` is the actual product: A2UI v0.9 message objects in order.
 *
 * The element type is deliberately `record(unknown)` rather than a modelled
 * A2UI schema. Two reasons:
 *
 * 1. A2UI's own schema is the source of truth (the client validates against it
 *    when rendering); duplicating it here would create a second definition that
 *    drifts.
 * 2. The safety rules are enforced by `checkSurfaceProduction` on the produced
 *    messages — a stricter zod schema would reject at parse time with a generic
 *    "invalid output", losing the specific violation kind we log and map to
 *    `GENERATIVE_OUTPUT_REJECTED`.
 */
/** Longest progress summary; it is server-only metadata, never user copy. */
const SUMMARY_MAX_LENGTH = 120;

/**
 * Bound on how many messages one generation may return.
 *
 * A surface is a handful of cards plus a heading, so 40 is already generous.
 * The cap exists to bound the response size and the replay cost on the client,
 * not to constrain expressiveness.
 */
const MESSAGES_MAX_COUNT = 40;

export const surfaceGenerationSchema = z.object({
  summary: z.string().trim().min(1).max(SUMMARY_MAX_LENGTH),
  messages: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(MESSAGES_MAX_COUNT),
});

export type SurfaceGenerationStructuredOutput = z.infer<
  typeof surfaceGenerationSchema
>;
