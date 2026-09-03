import { z } from 'zod';

/**
 * Standard Schema (zod 4) for the body returned by
 * `DELETE /assistant/memory`. Replaces the former
 * `AssistantClearMemoryDataDto` response class.
 */
export const assistantClearMemoryDataSchema = z.object({
  cleared: z
    .number()
    .describe('Number of persisted assistant memory rows deleted.'),
});

/** Strongly typed result of erasing all persisted assistant memories. */
export type AssistantClearMemoryDataDto = z.infer<
  typeof assistantClearMemoryDataSchema
>;

/**
 * Backwards-compatible response alias for `DELETE /assistant/memory`;
 * identical to {@link AssistantClearMemoryDataDto} on the wire.
 */
export type AssistantClearMemoryResponseDto = AssistantClearMemoryDataDto;
