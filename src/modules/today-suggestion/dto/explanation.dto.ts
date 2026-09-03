import { z } from 'zod';

/**
 * Standard Schema (zod 4) for the data payload of
 * `POST /today/suggestions/:id/explain`. Replaces the former
 * `SuggestionExplanationDataDto` response class.
 */
export const suggestionExplanationDataSchema = z.object({
  suggestionId: z.string().describe('The suggestion ID that was explained'),
  reason: z.string().describe('AI-enhanced or original reason text'),
  boundary: z
    .string()
    .describe('AI-enhanced or original boundary / disclaimer text'),
  aiGenerated: z
    .boolean()
    .describe('Whether the AI model was used to generate the explanation'),
  locale: z
    .string()
    .optional()
    .describe('Locale used for the explanation (e.g. "zh-CN", "en")'),
});

/** Strongly typed explanation data payload. */
export type SuggestionExplanationDataDto = z.infer<
  typeof suggestionExplanationDataSchema
>;

/**
 * Backwards-compatible response alias for the synchronous explain response;
 * identical to {@link SuggestionExplanationDataDto} on the wire.
 */
export type SuggestionExplanationResponseDto = SuggestionExplanationDataDto;

/**
 * Standard Schema (zod 4) for the async explanation response. Exactly one of
 * `jobId` and `result` is present: a configured queue returns the former, and
 * inline processing returns the latter.
 */
export const suggestionExplanationAsyncResponseSchema = z.object({
  jobId: z.string().optional().describe('Queued explanation job identifier.'),
  result: suggestionExplanationDataSchema
    .optional()
    .describe(
      'Inline explanation resource when queue processing is unavailable.',
    ),
});

/** Strongly typed async explanation response. */
export type SuggestionExplanationAsyncResponseDto = z.infer<
  typeof suggestionExplanationAsyncResponseSchema
>;
