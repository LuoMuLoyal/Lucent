import { z } from 'zod';

/**
 * zod 4 Standard Schemas for the medicine risk-check responses
 * (`GET`/`POST /medicines/risk-check`).
 *
 * Migrated from the former `@ApiProperty` response classes (class names kept
 * as `z.infer` type aliases; enum unions stay exported as plain TS types).
 * - enum-like unions → `z.enum` over local `as const` arrays (values kept
 *   identical to the former union literals);
 * - `@ApiPropertyOptional` nullable columns → optional keys (absent or `null`
 *   both valid) or `.nullable()` where the producer always emits the key;
 * - `createdAt`/`updatedAt` keep `format: date-time` via `z.iso.datetime()`
 *   so the client contract (DateTime) is unchanged.
 *
 * No `.strict()` / `.default()` — outbound validation must accept the shapes
 * produced by `MedicineRiskCheckService` (persisted records are read back from
 * the JSON `result` column unchanged).
 */

export type MedicineRiskLevel = 'safe' | 'caution' | 'risk' | 'danger';
const MEDICINE_RISK_LEVELS = ['safe', 'caution', 'risk', 'danger'] as const;

export type MedicineRiskFindingType =
  | 'interaction'
  | 'duplicateIngredient'
  | 'allergy'
  | 'foodInteraction'
  | 'longTermUse'
  | 'schedulingConflict'
  | 'specialGroup';
const MEDICINE_RISK_FINDING_TYPES = [
  'interaction',
  'duplicateIngredient',
  'allergy',
  'foodInteraction',
  'longTermUse',
  'schedulingConflict',
  'specialGroup',
] as const;

export type MedicineRiskSeverity = 'high' | 'medium' | 'info';
const MEDICINE_RISK_SEVERITIES = ['high', 'medium', 'info'] as const;

export type MedicineRiskFindingContext = 'none' | 'alcohol' | 'caffeine';
const MEDICINE_RISK_FINDING_CONTEXTS = ['none', 'alcohol', 'caffeine'] as const;

export type MedicineRiskCoverageReason =
  | 'manualEntry'
  | 'missingSourceRef'
  | 'detailUnavailable';
const MEDICINE_RISK_COVERAGE_REASONS = [
  'manualEntry',
  'missingSourceRef',
  'detailUnavailable',
] as const;

export type MedicineRedFlagRule = 'severeAllergy' | 'informationGap';
const MEDICINE_RED_FLAG_RULES = ['severeAllergy', 'informationGap'] as const;

export const medicineRiskFindingSchema = z.object({
  type: z.enum(MEDICINE_RISK_FINDING_TYPES).describe('Finding kind.'),
  severity: z.enum(MEDICINE_RISK_SEVERITIES).describe('Finding severity.'),
  context: z.enum(MEDICINE_RISK_FINDING_CONTEXTS).describe('Finding context.'),
  primaryMedicineName: z.string().describe('Medicine the finding is about.'),
  secondaryMedicineName: z
    .string()
    .optional()
    .describe('Second medicine involved.'),
  relatedLabel: z
    .string()
    .optional()
    .describe('Related label (e.g. allergen).'),
  evidence: z.string().optional().describe('Supporting evidence.'),
  recommendation: z.string().optional().describe('LLM check only'),
});

export const medicineRiskCoverageIssueSchema = z.object({
  medicineName: z.string().describe('Medicine name without source detail.'),
  reason: z
    .enum(MEDICINE_RISK_COVERAGE_REASONS)
    .describe('Why the medicine detail was not checked.'),
});

export const medicineRedFlagSchema = z.object({
  rule: z.enum(MEDICINE_RED_FLAG_RULES).describe('Red flag rule.'),
  primaryMedicineName: z.string().describe('Medicine the flag is about.'),
  relatedLabel: z.string().optional().describe('Related label.'),
});

export const medicineRiskCheckResponseSchema = z.object({
  overallRiskLevel: z
    .enum(MEDICINE_RISK_LEVELS)
    .describe('Overall risk level.'),
  overallRiskScore: z.number().describe('Overall risk score (0-100).'),
  currentMedicineCount: z.number().describe('Current medicine count.'),
  checkedMedicineCount: z.number().describe('Count actually checked.'),
  findings: z
    .array(medicineRiskFindingSchema)
    .describe('Detected risk findings.'),
  coverageIssues: z
    .array(medicineRiskCoverageIssueSchema)
    .describe('Medicines skipped due to missing detail.'),
  redFlags: z.array(medicineRedFlagSchema).describe('Raised red flags.'),
  overallRecommendation: z.string().optional().describe('LLM check only'),
});

export const medicineRiskCheckRecordSchema = z.object({
  checkType: z.enum(['static', 'llm']).describe('Type of risk check.'),
  result: medicineRiskCheckResponseSchema.describe('Check result.'),
  riskScore: z.number().describe('Persisted risk score (0-100).'),
  riskLevel: z.enum(MEDICINE_RISK_LEVELS).describe('Persisted risk level.'),
  stale: z.boolean().describe('Whether the record is stale.'),
  createdAt: z.iso.datetime().describe('Created at (ISO 8601).'),
  updatedAt: z.iso.datetime().describe('Updated at (ISO 8601).'),
});

export const medicineRiskCheckRecordsSchema = z.object({
  static: medicineRiskCheckRecordSchema
    .nullable()
    .describe('Latest static check record, null if never checked'),
  llm: medicineRiskCheckRecordSchema
    .nullable()
    .describe('Latest LLM check record, null if never checked'),
});

/** Envelope wrapper for `GET /risk-check` (list of records). */
export const medicineRiskCheckRecordsResponseSchema =
  medicineRiskCheckRecordsSchema;

/** Envelope wrapper for `POST /risk-check` (single record). */
export const medicineRiskCheckRecordResponseSchema =
  medicineRiskCheckRecordSchema;

/** Strongly typed check result payload. */
export type MedicineRiskCheckResponseDto = z.infer<
  typeof medicineRiskCheckResponseSchema
>;

/** Strongly typed single persisted record. */
export type MedicineRiskCheckRecordDto = z.infer<
  typeof medicineRiskCheckRecordSchema
>;

/** Strongly typed static/llm record pair. */
export type MedicineRiskCheckRecordsDto = z.infer<
  typeof medicineRiskCheckRecordsSchema
>;

/** Strongly typed single finding. */
export type MedicineRiskFindingDto = z.infer<typeof medicineRiskFindingSchema>;

/** Strongly typed coverage issue. */
export type MedicineRiskCoverageIssueDto = z.infer<
  typeof medicineRiskCoverageIssueSchema
>;

/** Strongly typed red flag. */
export type MedicineRedFlagDto = z.infer<typeof medicineRedFlagSchema>;

/** Envelope wrapper for `GET /risk-check` (list of records). */
export type MedicineRiskCheckRecordsResponseDto = MedicineRiskCheckRecordsDto;

/** Envelope wrapper for `POST /risk-check` (single record). */
export type MedicineRiskCheckRecordResponseDto = MedicineRiskCheckRecordDto;
