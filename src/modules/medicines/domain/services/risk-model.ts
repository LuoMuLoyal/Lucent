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

/**
 * 一条风险发现的**图证据**：为什么会有这条冲突。
 *
 * 可选字段：图里不一定有对应关系（图只覆盖 895 个药）。没有时如实标注
 * `notFound`，**不编造**听起来合理的解释——可溯源的前提是「没有就说没有」。
 */
export interface MedicineRiskMechanism {
  /** 冲突经哪条路径发生：酶介导（CYP 等）、共享靶点、转运体。 */
  kind: 'enzyme' | 'target' | 'transporter';
  /** 通过的酶/靶点/转运体基因符号，如 `CYP2C9`。 */
  geneSymbol: string;
  /** 该实体的显示名。 */
  entityName: string;
  /** 起始药物在该实体上的作用（`INHIBITS` / `INDUCES` / `ACTS_ON`）。 */
  relation: string;
}

/**
 * 机制查询结果。
 *
 * `unavailable` / `timeout` / `notConfigured` 与 `notFound` 必须分开：
 * 前者是**我们无法回答**，后者是**答案是「没有」**。合并会让界面把知识缺口
 * 显示成「机制上无问题」。
 */
export type MedicineRiskMechanismOutcome =
  | { status: 'ok'; mechanisms: MedicineRiskMechanism[] }
  | { status: 'notFound' }
  | { status: 'notConfigured' | 'unavailable' | 'timeout' };

export interface MedicineRiskFinding {
  type: MedicineRiskFindingType;
  severity: MedicineRiskSeverity;
  context: MedicineRiskFindingContext;
  primaryMedicineName: string;
  secondaryMedicineName?: string | undefined;
  relatedLabel?: string | undefined;
  evidence?: string | undefined;
  recommendation?: string | undefined;
  /** 图证据；仅 `interaction` 类发现会尝试补充。 */
  mechanism?: MedicineRiskMechanismOutcome | undefined;
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
