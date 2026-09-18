/**
 * Zod schema for AI-generated suggestion copy.
 */
import { z } from 'zod';

/**
 * Schema for generated copy output.
 */
/**
 * Detects an internal identifier leaking into user-facing copy.
 *
 * The prompt passes `templateKey` / `params` alongside the request, so the
 * model can echo a key such as `complete_profile` back as its answer. A
 * label with no space that is all lower-case-with-underscores (or camelCase)
 * is an identifier, not display text; rejecting it here keeps the key out of
 * the card and lets the caller fall back to the rule's localized label.
 */
const INTERNAL_IDENTIFIER =
  /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$|^[a-z]+(?:[A-Z][a-z0-9]*)+$/;

export const GeneratedCopySchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(30, 'Title should be concise (max 30 chars)'),
  reason: z
    .string()
    .min(1, 'Reason is required')
    .max(200, 'Reason should be brief (max 200 chars)'),
  boundary: z
    .string()
    .min(1, 'Boundary is required')
    .max(150, 'Boundary should be concise (max 150 chars)'),
  actionLabel: z
    .string()
    .min(1, 'Action label is required')
    .max(10, 'Action label should be very short (max 10 chars)')
    .refine(
      (value) => !INTERNAL_IDENTIFIER.test(value.trim()),
      'Action label must be display text, not an internal identifier',
    ),
});

export type GeneratedCopy = z.infer<typeof GeneratedCopySchema>;

/**
 * Validates and parses the AI-generated copy.
 */
export function parseGeneratedCopy(data: unknown): GeneratedCopy {
  return GeneratedCopySchema.parse(data);
}

/**
 * Safely parses the AI-generated copy, returning null if invalid.
 */
export function safeParseGeneratedCopy(data: unknown): GeneratedCopy | null {
  const result = GeneratedCopySchema.safeParse(data);
  return result.success ? result.data : null;
}
