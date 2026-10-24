/**
 * Medicine risk model — pure domain vocabulary for the static and LLM risk
 * assessments. The HTTP zod schemas (`adapters/http/dto/risk-check.response`)
 * build their wire schemas on these unions, and `MedicineRiskCheckRecord` /
 * `MedicineRiskCheckResult` are the shapes the risk-check use case returns.
 */

export type MedicineRiskLevel = 'safe' | 'caution' | 'risk' | 'danger';
export const MEDICINE_RISK_LEVELS = [
  'safe',
  'caution',
  'risk',
  'danger',
] as const;

export type MedicineRiskFindingType =
  | 'interaction'
  | 'duplicateIngredient'
  | 'allergy'
  | 'foodInteraction'
  | 'longTermUse'
  | 'schedulingConflict'
  | 'specialGroup';
export const MEDICINE_RISK_FINDING_TYPES = [
  'interaction',
  'duplicateIngredient',
  'allergy',
  'foodInteraction',
  'longTermUse',
  'schedulingConflict',
  'specialGroup',
] as const;

export type MedicineRiskSeverity = 'high' | 'medium' | 'info';
export const MEDICINE_RISK_SEVERITIES = ['high', 'medium', 'info'] as const;

export type MedicineRiskFindingContext = 'none' | 'alcohol' | 'caffeine';
export const MEDICINE_RISK_FINDING_CONTEXTS = [
  'none',
  'alcohol',
  'caffeine',
] as const;

export type MedicineRiskCoverageReason =
  | 'manualEntry'
  | 'missingSourceRef'
  | 'detailUnavailable';
export const MEDICINE_RISK_COVERAGE_REASONS = [
  'manualEntry',
  'missingSourceRef',
  'detailUnavailable',
] as const;

export type MedicineRedFlagRule = 'severeAllergy' | 'informationGap';
export const MEDICINE_RED_FLAG_RULES = [
  'severeAllergy',
  'informationGap',
] as const;

export interface MedicineRiskFinding {
  type: MedicineRiskFindingType;
  severity: MedicineRiskSeverity;
  context: MedicineRiskFindingContext;
  primaryMedicineName: string;
  secondaryMedicineName?: string | undefined;
  relatedLabel?: string | undefined;
  evidence?: string | undefined;
  recommendation?: string | undefined;
}

export interface MedicineRiskCoverageIssue {
  medicineName: string;
  reason: MedicineRiskCoverageReason;
}

export interface MedicineRedFlag {
  rule: MedicineRedFlagRule;
  primaryMedicineName: string;
  relatedLabel?: string | undefined;
}

export interface MedicineRiskCheckResult {
  overallRiskLevel: MedicineRiskLevel;
  overallRiskScore: number;
  currentMedicineCount: number;
  checkedMedicineCount: number;
  findings: MedicineRiskFinding[];
  coverageIssues: MedicineRiskCoverageIssue[];
  redFlags: MedicineRedFlag[];
  overallRecommendation?: string | undefined;
}

export interface MedicineRiskCheckRecord {
  checkType: 'static' | 'llm';
  result: MedicineRiskCheckResult;
  riskScore: number;
  riskLevel: MedicineRiskLevel;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}
