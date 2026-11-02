/**
 * Finding-level domain vocabulary for a risk assessment.
 *
 * A finding is a **value object**: it describes one reason the assessment is
 * not clean, and it is immutable once produced. This file owns the two pieces
 * of knowledge the rest of the module keeps needing:
 *
 * 1. **the severity ladder** — which severity outranks which;
 * 2. **what counts as noteworthy** — findings above the informational level.
 *
 * Both used to be implicit: the ladder lived in an `if/else` chain inside
 * `risk-scoring.ts`'s score calculation, and "above informational" was only
 * ever expressed as `severity !== 'info'` at the few call sites that happened
 * to need it. Naming them here means the event payload, the scoring and any
 * future consumer all agree on the same ordering.
 *
 * Note the two vocabularies this module deliberately keeps apart:
 * `MedicineRiskSeverity` (`high`/`medium`/`info`) is **one finding's** weight;
 * `MedicineRiskLevel` (`safe`/`caution`/`risk`/`danger`) is **the whole
 * assessment's** band, derived from the 0–100 score. Collapsing them would
 * make "one high finding" and "a dangerous combination" indistinguishable.
 */

import type {
  MedicineRiskFinding,
  MedicineRiskSeverity,
} from '../services/risk-model.js';

export type { MedicineRiskFinding, MedicineRiskSeverity };

/** One finding, as stored inside an assessment. */
export type RiskFinding = MedicineRiskFinding;

/**
 * Severity ladder, most severe first.
 *
 * Order is load-bearing: `highestSeverity` walks it, so adding a rung means
 * deciding where it sits relative to the others — which is the point of
 * having it written down.
 */
export const RISK_SEVERITY_ORDER: readonly MedicineRiskSeverity[] = [
  'high',
  'medium',
  'info',
] as const;

/**
 * Severities that are worth surfacing beyond the detail list.
 *
 * `info` findings are context, not warnings (e.g. a mild allergy note), so the
 * "noteworthy" count the assessment publishes excludes them. Keeping this a
 * named predicate rather than an inline `!== 'info'` means a future rung can
 * be classified once instead of at every comparison.
 */
const NOTEWORTHY_SEVERITIES: ReadonlySet<MedicineRiskSeverity> = new Set([
  'high',
  'medium',
]);

/** `true` when a finding of this severity deserves to be counted as a warning. */
export function isNoteworthySeverity(severity: MedicineRiskSeverity): boolean {
  return NOTEWORTHY_SEVERITIES.has(severity);
}

/** Rank of `severity` on the ladder; lower is more severe. */
export function severityRank(severity: MedicineRiskSeverity): number {
  const rank = RISK_SEVERITY_ORDER.indexOf(severity);
  // An unknown rung would silently compare as "least severe" and understate a
  // real risk, so treat it as the most severe instead.
  return rank === -1 ? 0 : rank;
}

/**
 * Most severe severity present, or `null` when there are no findings.
 *
 * `null` is not `info`: "we found nothing" and "we found something minor" are
 * different answers, and a consumer that renders them the same would show a
 * clean assessment for one that merely had no findings recorded.
 */
export function highestSeverity(
  findings: readonly MedicineRiskFinding[],
): MedicineRiskSeverity | null {
  let highest: MedicineRiskSeverity | null = null;
  for (const finding of findings) {
    if (
      highest === null ||
      severityRank(finding.severity) < severityRank(highest)
    ) {
      highest = finding.severity;
    }
  }
  return highest;
}

/** Findings whose severity is above the informational level. */
export function noteworthyFindings(
  findings: readonly MedicineRiskFinding[],
): MedicineRiskFinding[] {
  return findings.filter((finding) => isNoteworthySeverity(finding.severity));
}
