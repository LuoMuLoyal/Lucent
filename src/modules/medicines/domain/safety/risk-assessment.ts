/**
 * `RiskAssessment` aggregate root (ADR-0024 §4) — Medication Safety context.
 *
 * One assessment answers "is this set of medicines risky for this user?" and is
 * **immutable once completed**: a new check replaces the previous one rather
 * than mutating it, which is why there is no update path anywhere in this file.
 *
 * ## Why the score is derived here and not passed in
 *
 * For a static check the score is a pure function of the findings: same input,
 * same score. Keeping that derivation inside the aggregate means a caller
 * cannot hand over a score that disagrees with the findings it is stored next
 * to — the two can no longer drift, because only one of them is an input.
 *
 * The LLM check is genuinely different: the model returns its own score, so
 * that path takes the score as input. The two are separate factories on
 * purpose — `completeStaticAssessment` derives, `completeLlmAssessment`
 * accepts, and which one ran is visible at every call site instead of hidden
 * behind a boolean.
 *
 * ## The coverage identity
 *
 * `currentMedicineCount === checkedMedicineCount + coverageIssues.length`.
 *
 * Every medicine the user is on is either checked or reported as uncovered;
 * an assessment that silently drops one is claiming more confidence than it
 * has. This is the invariant that keeps "查不到详情的药" from vanishing — the
 * README calls the same thing 「不让整体失败」.
 *
 * ## Layer purity
 *
 * ADR-0024 rule D1: `domain/` imports nothing outside `domain/`. That is why
 * validation returns a discriminated result instead of throwing a framework
 * exception, and why `RiskCheckKind` is declared here rather than re-used from
 * `application/ports/`.
 */

import type {
  MedicineRiskCheckResult,
  MedicineRiskCoverageIssue,
  MedicineRedFlag,
  MedicineRiskLevel,
  MedicineRiskFinding,
} from '../services/risk-model.js';
import { isNoteworthySeverity } from './risk-finding.js';

/** Which engine produced the assessment. */
export type RiskCheckKind = 'static' | 'llm';

// ─── Score derivation ──────────────────────────────────────────────────────

/**
 * Points contributed per finding severity.
 *
 * Named because they are the actual risk model: the 30/15/5 split is what
 * makes one high-severity interaction outrank three informational notes, and a
 * reader should be able to see that ratio rather than reverse it out of an
 * `if/else` chain.
 */
const POINTS_PER_HIGH_SEVERITY = 30;
const POINTS_PER_MEDIUM_SEVERITY = 15;
const POINTS_PER_INFO_SEVERITY = 5;

/** A medicine we could not check still costs confidence, but less than a finding. */
const POINTS_PER_COVERAGE_ISSUE = 3;

/** A severe allergy is a hard stop, so it outweighs any single finding. */
const POINTS_PER_SEVERE_ALLERGY_RED_FLAG = 40;
const POINTS_PER_OTHER_RED_FLAG = 10;

/** The score saturates here; the band thresholds below are read against it. */
const MAX_RISK_SCORE = 100;

/** Upper bounds (inclusive) of the `safe` / `caution` bands. */
const SAFE_SCORE_CEILING = 10;
const CAUTION_SCORE_CEILING = 40;
const RISK_SCORE_CEILING = 70;

/** Points for one finding, by severity. */
function pointsForFinding(severity: MedicineRiskFinding['severity']): number {
  switch (severity) {
    case 'high':
      return POINTS_PER_HIGH_SEVERITY;
    case 'medium':
      return POINTS_PER_MEDIUM_SEVERITY;
    default:
      return POINTS_PER_INFO_SEVERITY;
  }
}

/**
 * Derives the 0–100 score from the findings, coverage gaps and red flags.
 *
 * Exported so the risk-detection service and the aggregate share exactly one
 * implementation: two copies would let the stored score and the stored
 * findings tell different stories.
 */
export function deriveRiskScore(
  findings: readonly MedicineRiskFinding[],
  coverageIssues: readonly MedicineRiskCoverageIssue[],
  redFlags: readonly MedicineRedFlag[],
): number {
  let score = 0;
  for (const finding of findings) {
    score += pointsForFinding(finding.severity);
  }
  score += coverageIssues.length * POINTS_PER_COVERAGE_ISSUE;
  for (const redFlag of redFlags) {
    score +=
      redFlag.rule === 'severeAllergy'
        ? POINTS_PER_SEVERE_ALLERGY_RED_FLAG
        : POINTS_PER_OTHER_RED_FLAG;
  }
  return Math.min(MAX_RISK_SCORE, score);
}

/** Maps a 0–100 score onto its risk band. */
export function levelForScore(score: number): MedicineRiskLevel {
  if (score <= SAFE_SCORE_CEILING) return 'safe';
  if (score <= CAUTION_SCORE_CEILING) return 'caution';
  if (score <= RISK_SCORE_CEILING) return 'risk';
  return 'danger';
}

// ─── Aggregate ─────────────────────────────────────────────────────────────

/**
 * A completed risk assessment.
 *
 * Every field is `readonly`: the aggregate is a fact about a moment, and the
 * only way to change the answer is to run another check.
 */
export interface RiskAssessment {
  readonly userId: string;
  readonly checkType: RiskCheckKind;
  readonly result: MedicineRiskCheckResult;
  readonly riskScore: number;
  readonly riskLevel: MedicineRiskLevel;
  /** Which medicines this assessment was computed over. */
  readonly medicineIds: readonly string[];
  /** Findings above the informational level — the "warnings" count. */
  readonly noteworthyFindingCount: number;
  readonly completedAt: Date;
}

/** Why an assessment could not be formed. */
export type RiskAssessmentViolation =
  | {
      readonly kind: 'coverageMismatch';
      readonly currentMedicineCount: number;
      readonly checkedMedicineCount: number;
      readonly coverageIssueCount: number;
    }
  | {
      readonly kind: 'scoreOutOfRange';
      readonly score: number;
    };

/** Discriminated result: an aggregate, or the invariant it failed. */
export type RiskAssessmentOutcome =
  | { readonly ok: true; readonly assessment: RiskAssessment }
  | { readonly ok: false; readonly violation: RiskAssessmentViolation };

/** Input shared by both check kinds. */
export interface RiskAssessmentInput {
  userId: string;
  checkType: RiskCheckKind;
  result: MedicineRiskCheckResult;
  /** Ids of the medicines the assessment covered (box items + candidate). */
  medicineIds: readonly string[];
  completedAt?: Date;
}

/**
 * The coverage identity, checked in one place.
 *
 * Returning the three counts on violation (rather than a message) means a
 * caller can log the discrepancy structurally instead of re-deriving it.
 */
function checkCoverageIdentity(
  result: MedicineRiskCheckResult,
): RiskAssessmentViolation | null {
  const { currentMedicineCount, checkedMedicineCount, coverageIssues } = result;
  if (currentMedicineCount !== checkedMedicineCount + coverageIssues.length) {
    return {
      kind: 'coverageMismatch',
      currentMedicineCount,
      checkedMedicineCount,
      coverageIssueCount: coverageIssues.length,
    };
  }
  return null;
}

function checkScoreRange(score: number): RiskAssessmentViolation | null {
  if (!Number.isInteger(score) || score < 0 || score > MAX_RISK_SCORE) {
    return { kind: 'scoreOutOfRange', score };
  }
  return null;
}

function countNoteworthy(findings: readonly MedicineRiskFinding[]): number {
  let count = 0;
  for (const finding of findings) {
    if (isNoteworthySeverity(finding.severity)) {
      count += 1;
    }
  }
  return count;
}

function buildAssessment(
  input: RiskAssessmentInput,
  score: number,
  level: MedicineRiskLevel,
): RiskAssessmentOutcome {
  const coverageViolation = checkCoverageIdentity(input.result);
  if (coverageViolation !== null) {
    return { ok: false, violation: coverageViolation };
  }
  const scoreViolation = checkScoreRange(score);
  if (scoreViolation !== null) {
    return { ok: false, violation: scoreViolation };
  }

  return {
    ok: true,
    assessment: {
      userId: input.userId,
      checkType: input.checkType,
      result: input.result,
      riskScore: score,
      riskLevel: level,
      medicineIds: [...input.medicineIds],
      noteworthyFindingCount: countNoteworthy(input.result.findings),
      completedAt: input.completedAt ?? new Date(),
    },
  };
}

/**
 * Completes a **static** assessment, deriving score and level from the findings.
 *
 * The derivation is the invariant: callers cannot supply a score, so a stored
 * score can never contradict the findings stored beside it.
 */
export function completeStaticAssessment(
  input: Omit<RiskAssessmentInput, 'checkType'>,
): RiskAssessmentOutcome {
  const score = deriveRiskScore(
    input.result.findings,
    input.result.coverageIssues,
    input.result.redFlags,
  );
  return buildAssessment(
    { ...input, checkType: 'static' },
    score,
    levelForScore(score),
  );
}

/**
 * Completes an **LLM** assessment.
 *
 * The model returns its own score, so it is taken as given — but it is still
 * range-checked, because a stored score outside 0–100 would break the band
 * contract every reader relies on.
 */
export function completeLlmAssessment(
  input: Omit<RiskAssessmentInput, 'checkType'>,
): RiskAssessmentOutcome {
  return buildAssessment(
    { ...input, checkType: 'llm' },
    input.result.overallRiskScore,
    input.result.overallRiskLevel,
  );
}
