import { z } from 'zod';

/**
 * Zod schema for the AI explanation structured output.
 *
 * The LLM generates enhanced `reason` and `boundary` text variants
 * based on the suggestion's evidence array.
 */
export const explanationSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe(
      'A natural-language explanation of why this suggestion appeared, grounded in the evidence.',
    ),
  boundary: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      'A medical disclaimer / boundary note clarifying the limits of this suggestion.',
    ),
});

export type ExplanationStructuredOutput = z.infer<typeof explanationSchema>;
