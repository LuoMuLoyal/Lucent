import { z } from 'zod';

/**
 * R-3: 纵向洞察生成器 schema.
 *
 * Output is constrained to: time range, coverage, at most one
 * source-backed observed pattern, and at most one low-risk action.
 * When data is insufficient the model MUST abstain — it returns
 * the fixed abstain string and leaves observedPattern / lowRiskAction
 * null. No generalized prose.
 */
export const reportSummarySchema = z.object({
  summary: z.string().trim().min(1).max(160),
  coverage: z.object({
    medication: z.object({
      trackedDays: z.number().int().min(0),
      totalDays: z.number().int().min(0),
    }),
    water: z.object({
      trackedDays: z.number().int().min(0),
      totalDays: z.number().int().min(0),
    }),
    sleep: z.object({
      trackedDays: z.number().int().min(0),
      totalDays: z.number().int().min(0),
    }),
  }),
  observedPattern: z
    .object({
      kind: z.enum(['medication', 'hydration', 'sleep']),
      text: z.string().trim().min(1).max(96),
      source: z.string().trim().min(1).max(48),
    })
    .nullable(),
  lowRiskAction: z
    .object({
      label: z.string().trim().min(1).max(24),
      text: z.string().trim().min(1).max(96),
    })
    .nullable(),
  disclaimer: z.string().trim().min(1).max(120),
});

export type ReportSummaryStructuredOutput = z.infer<typeof reportSummarySchema>;
