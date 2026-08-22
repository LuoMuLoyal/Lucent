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

export type AssistantToolDetailData = z.infer<
  typeof assistantToolDetailDataSchema
>;
