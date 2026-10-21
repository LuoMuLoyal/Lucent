import { z } from 'zod';

export const MEDICINE_RISK_LLM_FINDING_TYPES = [
  'interaction',
  'duplicateIngredient',
  'allergy',
  'foodInteraction',
  'longTermUse',
  'schedulingConflict',
  'specialGroup',
] as const;

export const medicineRiskLlmSchema = z.object({
  summary: z.string().trim().min(1).max(200),
  riskScore: z.number().min(0).max(100),
  riskLevel: z.enum(['safe', 'caution', 'risk', 'danger']),
  findings: z
    .array(
      z.object({
        type: z.enum(MEDICINE_RISK_LLM_FINDING_TYPES),
        severity: z.enum(['high', 'medium', 'info']),
        title: z.string().trim().min(1).max(100),
        description: z.string().trim().min(1).max(500),
        recommendation: z.string().trim().min(1).max(500),
        primaryMedicineName: z.string().trim().min(1).max(200),
        secondaryMedicineName: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .max(10),
  overallRecommendation: z.string().trim().min(1).max(500),
});

export type MedicineRiskLlmOutput = z.infer<typeof medicineRiskLlmSchema>;
