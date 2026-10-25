import { z } from 'zod';

const coverageSchema = z
  .object({
    status: z.enum(['complete', 'partial', 'empty']),
    reason: z.string().nullable(),
  })
  .strict();

const confidenceSchema = z
  .object({
    level: z.enum(['high', 'medium', 'low']),
    reason: z.string(),
  })
  .strict();

const sourceSchema = z
  .object({
    tool: z.string(),
    generatedAt: z.string(),
    tables: z.array(z.string()),
  })
  .strict();

/**
 * One provenance citation from a knowledge tool.
 *
 * Unknown keys are stripped rather than rejected. The rest of this file is
 * strict on purpose — envelope drift should be noticed — but a citation list
 * that fails to parse costs the client the evidence behind an answer, and a
 * future field would cause exactly that. `metadata` is not projected: it holds
 * the tool's internal per-row detail and belongs to the model-facing envelope,
 * not to the source strip.
 */
const citationSchema = z.object({
  id: z.string(),
  entityType: z.string().optional(),
  sourceDocument: z.string().optional(),
  sourceLocation: z.string().optional(),
  sourceQuote: z.string().optional(),
  activityId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  sequenceId: z.number().nullable().optional(),
  checksum: z.string().nullable().optional(),
  parentEntityId: z.string().nullable().optional(),
});

/** Runtime-validated optional metadata projected into the assistant SSE detail. */
export const assistantToolDetailDataSchema = z
  .object({
    coverage: coverageSchema.nullable().optional(),
    confidence: confidenceSchema.nullable().optional(),
    ambiguities: z.array(z.string()).optional(),
    source: sourceSchema.nullable().optional(),
    disclaimer: z.string().nullable().optional(),
  })
  .strict();

/**
 * Citations are validated on their own rather than inside the object above.
 *
 * They are tool-specific result data, not envelope metadata: a citation that
 * fails to parse must not cost the client the coverage, confidence and source
 * rows that did parse.
 */
export const assistantToolCitationsSchema = z.array(citationSchema);

export type AssistantToolDetailData = z.infer<
  typeof assistantToolDetailDataSchema
>;
export type AssistantToolCitationData = z.infer<typeof citationSchema>;
