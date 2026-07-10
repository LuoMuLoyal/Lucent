/**
 * Zod schemas for JSONB fields stored in the database.
 *
 * These schemas are used at read time to validate that JSONB payloads match
 * the expected shape. When validation fails, the reader falls back to a safe
 * default rather than crashing the request.
 */
import { z } from 'zod';

// ── Meal analysis payload (UserDailyRecord.payload) ─────────────────────────

const mealAnalysisStatusSchema = z.enum([
  'analyzing',
  'unconfirmed',
  'confirmed',
  'analysis_failed',
]);

const mealAnalysisCoverageSchema = z.enum(['none', 'partial', 'complete']);

const mealRecognizedDishSchema = z.object({
  dishKey: z.string(),
  rawName: z.string(),
  normalizedDishName: z.string(),
  confidence: z.number().nullable(),
  portionText: z.string().nullable(),
  source: z.literal('vision'),
});

const mealResolvedIngredientSchema = z.object({
  dishKey: z.string(),
  ingredientName: z.string(),
  normalizedIngredientName: z.string(),
  defaultRatio: z.number().nullable(),
  decompositionSource: z.enum(['template', 'model']),
  confidence: z.number().nullable(),
});

const mealCompositionMatchSchema = z.object({
  dishKey: z.string(),
  ingredientName: z.string(),
  matchedFoodId: z.string().nullable(),
  matchedFoodName: z.string().nullable(),
  matchMethod: z.enum(['exact', 'alias', 'fuzzy', 'unmatched']),
  matchScore: z.number(),
});

/**
 * Zod schema for the `mealAnalysis` object inside `UserDailyRecord.payload`.
 *
 * All fields are optional because the payload may be written at different
 * stages of the analysis pipeline. Unknown keys are stripped.
 */
export const mealAnalysisPayloadSchema = z
  .object({
    analysisStatus: mealAnalysisStatusSchema.optional(),
    coverage: mealAnalysisCoverageSchema.optional(),
    mealDescription: z.string().nullable().optional(),
    foodItems: z.array(z.record(z.string(), z.unknown())).optional(),
    recognizedDishes: z.array(mealRecognizedDishSchema).optional(),
    resolvedIngredients: z.array(mealResolvedIngredientSchema).optional(),
    compositionMatches: z.array(mealCompositionMatchSchema).optional(),
    nutritionEstimate: z.record(z.string(), z.unknown()).nullable().optional(),
    mealCommentary: z.string().nullable().optional(),
    matchDiagnostics: z.record(z.string(), z.unknown()).nullable().optional(),
    failureReason: z.string().nullable().optional(),
    analyzedAt: z.string().nullable().optional(),
    confirmedAt: z.string().nullable().optional(),
    sourceRevision: z.number().optional(),
    imageObjectKey: z.string().nullable().optional(),
  })
  .loose();

/**
 * Zod schema for the full `UserDailyRecord.payload` JSONB when the record
 * kind is `meal`.
 *
 * Non-meal records may have arbitrary payload shapes, so this schema is only
 * applied when `kind === 'meal'`.
 */
export const mealRecordPayloadSchema = z
  .object({
    mealInput: z.record(z.string(), z.unknown()).nullable().optional(),
    mealAnalysis: mealAnalysisPayloadSchema.nullable().optional(),
    mealAnalysisLastConfirmed: mealAnalysisPayloadSchema.nullable().optional(),
  })
  .loose();

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
