/**
 * Zod schemas for JSONB fields stored in the database.
 *
 * These schemas are used at read time to validate that JSONB payloads match
 * the expected shape. When validation fails, the reader falls back to a safe
 * default rather than crashing the request.
 */
import { z } from 'zod';

// ── User suggestion evidence (UserSuggestion.evidence) ───────────────────────

export const suggestionEvidenceSchema = z
  .object({
    metrics: z.record(z.string(), z.unknown()).optional(),
    records: z.array(z.record(z.string(), z.unknown())).optional(),
    baseline: z.record(z.string(), z.unknown()).optional(),
    trend: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

// ── Suggestion primary action (UserSuggestion.primaryAction) ─────────────────

export const suggestionActionSchema = z
  .object({
    type: z.string(),
    label: z.string().optional(),
    target: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

// ── Assistant message used tools (AssistantMessage.usedTools) ─────────────────

export const assistantUsedToolsSchema = z.array(
  z.object({
    name: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
);

/**
 * Safely parses a JSONB value against a Zod schema, returning a fallback
 * on failure and logging a warning.
 *
 * @param raw - The raw JSONB value from the database.
 * @param schema - The Zod schema to validate against.
 * @param fallback - The value to return when validation fails.
 * @param label - A human-readable label for logging.
 */
export function safeParseJsonb<T>(
  raw: unknown,
  schema: {
    safeParse: (
      data: unknown,
    ) => { success: true; data: T } | { success: false; error: unknown };
  },
  fallback: T,
  _label: string,
): T {
  const result = schema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  // Don't throw — return the fallback so the request doesn't crash.
  // The caller can decide whether to log or handle the degraded state.
  return fallback;
}
