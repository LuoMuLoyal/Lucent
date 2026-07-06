import { z } from 'zod';

export const TODAY_ANALYSIS_BULLET_KINDS = [
  'medication',
  'hydration',
  'sleep',
  'general',
] as const;

export const todayAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(120),
  bullets: z
    .array(
      z.object({
        kind: z.enum(TODAY_ANALYSIS_BULLET_KINDS),
        text: z.string().trim().min(1).max(80),
      }),
    )
    .min(2)
    .max(3),
  actionLabel: z.string().trim().min(1).max(24),
  action: z.string().trim().min(1).max(24),
  confidenceNote: z.string().trim().min(1).max(80),
});

export type TodayAnalysisStructuredOutput = z.infer<typeof todayAnalysisSchema>;
