/**
 * Zod schema for AI-generated suggestion copy.
 */
import { z } from 'zod';
import {
  ACTION_LABEL_TEMPLATES,
  COPY_TEMPLATES,
} from '../constants/copy-templates.js';

/**
 * Schema for generated copy output.
 */
/**
 * The finite set of internal identifiers the model can echo back as its answer.
 *
 * Derived from the two registries instead of hand-listed, because those are
 * literally what the prompt hands the model: the action-label registry (both the
 * long form and the short one) plus every `actionKeys` entry the rules pass
 * alongside `templateKey`. A shape-based net cannot cover this set — a rename to
 * a single lower-case word (`record`, `confirm`, `save`) has no underscore and
 * no case change, and the dotted template keys this module actually ships
 * (`water.behind.target`) never matched the old pattern either.
 */
export const KNOWN_INTERNAL_ACTION_LABELS: ReadonlySet<string> = new Set(
  [
    ...Object.keys(ACTION_LABEL_TEMPLATES),
    ...Object.values(ACTION_LABEL_TEMPLATES).flatMap((template) => [
      template.default,
      ...(template.short != null ? [template.short] : []),
    ]),
    ...Object.values(COPY_TEMPLATES).flatMap(
      (template) => template.actionKeys ?? [],
    ),
  ].map((label) => label.trim()),
);

/**
 * Detects an internal identifier leaking into user-facing copy.
 *
 * The prompt passes `templateKey` / `params` alongside the request, so the
 * model can echo a key such as `complete_profile` back as its answer. Two nets
 * catch that: the registry above for identifiers we actually ship, and a shape
 * test for underscore/camelCase identifiers we have not shipped yet. Both are
 * case-sensitive so that ordinary capitalized display text ("Record") survives.
 * Rejecting here keeps the key out of the card and lets the caller fall back to
 * the rule's localized label.
 */
const INTERNAL_IDENTIFIER =
  /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$|^[a-z]+(?:[A-Z][a-z0-9]*)+$/;

function isInternalIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return (
    KNOWN_INTERNAL_ACTION_LABELS.has(trimmed) ||
    INTERNAL_IDENTIFIER.test(trimmed)
  );
}

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
      (value) => !isInternalIdentifier(value),
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
