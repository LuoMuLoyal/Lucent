import { z } from 'zod';

export const REPORT_SUMMARY_BULLET_KINDS = [
  'medication',
  'hydration',
  'sleep',
  'general',
] as const;

export const reportSummarySchema = z.object({
  summary: z.string().trim().min(1).max(160),
  bullets: z
    .array(
      z.object({
        kind: z.enum(REPORT_SUMMARY_BULLET_KINDS),
        text: z.string().trim().min(1).max(96),
      }),
    )
    .min(2)
    .max(3),
  actionLabel: z.string().trim().min(1).max(24),
  action: z.string().trim().min(1).max(24),
  confidenceNote: z.string().trim().min(1).max(96),
});

export type ReportSummaryStructuredOutput = z.infer<typeof reportSummarySchema>;
