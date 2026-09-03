import { z } from 'zod';
import { suggestionItemSchema } from './suggestion-response.dto.js';

/**
 * Standard Schema (zod 4) for the Today page suggestion cards returned by
 * `GET /today/suggestions`. Replaces the former `TodaySuggestionsDataDto`
 * response class.
 */
export const todaySuggestionsDataSchema = z.object({
  generatedAt: z.string().describe('When the suggestions were generated'),
  primary: suggestionItemSchema
    .optional()
    .describe('Primary suggestion card (highest priority)'),
  secondary: z
    .array(suggestionItemSchema)
    .optional()
    .describe('Secondary suggestion cards (max 2)'),
  observations: z
    .array(suggestionItemSchema)
    .optional()
    .describe('Low-confidence observations'),
  degraded: z
    .boolean()
    .optional()
    .describe(
      'When true, one or more suggestion rules threw an error during evaluation — the returned list may be incomplete.',
    ),
  materializationStatus: z
    .enum(['empty', 'pending', 'ready', 'stale', 'failed'])
    .describe('Current background materialization state'),
  sourceVersion: z
    .number()
    .describe('Latest source version observed for this date'),
  computedAt: z
    .string()
    .nullable()
    .describe('When the last successful materialization completed'),
  retryAfterSeconds: z
    .number()
    .nullable()
    .describe('Suggested client polling delay in seconds'),
});

/** Strongly typed Today page suggestion cards payload. */
export type TodaySuggestionsDataDto = z.infer<
  typeof todaySuggestionsDataSchema
>;

/**
 * Backwards-compatible response alias for `GET /today/suggestions`;
 * identical to {@link TodaySuggestionsDataDto} on the wire.
 */
export type TodaySuggestionsResponseDto = TodaySuggestionsDataDto;
