import {
  completeLlmAssessment,
  completeStaticAssessment,
  deriveRiskScore,
  levelForScore,
  type RiskAssessmentInput,
} from './risk-assessment.js';
import {
  highestSeverity,
  isNoteworthySeverity,
  noteworthyFindings,
} from './risk-finding.js';
import type {
  MedicineRiskCheckResult,
  MedicineRiskFinding,
} from '../services/risk-model.js';

/**
 * Pure unit tests for the Medication Safety aggregate — no Prisma, no Nest
 * container, no mocks. These cover the invariants that only exist because the
 * aggregate owns them; anything that needs a database belongs in the
 * persistence spec instead.
 */

function finding(
  overrides: Partial<MedicineRiskFinding> = {},
): MedicineRiskFinding {
  return {
    type: 'interaction',
    severity: 'high',
    context: 'none',
    primaryMedicineName: '华法林',
    ...overrides,
  };
}

/**
 * Builds a result whose counts satisfy the coverage identity, so a test only
 * has to state the fields it actually cares about.
 */
function result(
  overrides: Partial<MedicineRiskCheckResult> = {},
): MedicineRiskCheckResult {
  const findings = overrides.findings ?? [];
  const coverageIssues = overrides.coverageIssues ?? [];
  const checkedMedicineCount = overrides.checkedMedicineCount ?? 1;
  return {
    overallRiskLevel: 'safe',
    overallRiskScore: 0,
    currentMedicineCount: checkedMedicineCount + coverageIssues.length,
    checkedMedicineCount,
    findings,
    coverageIssues,
    redFlags: [],
    ...overrides,
  };
}

function input(
  overrides: Partial<RiskAssessmentInput> = {},
): Omit<RiskAssessmentInput, 'checkType'> {
  return {
    userId: 'u1',
    result: result(),
    medicineIds: ['m1'],
    completedAt: new Date('2026-10-24T00:00:00.000Z'),
    ...overrides,
  };
}

describe('deriveRiskScore / levelForScore', () => {
  it('scores each severity by its own weight', () => {
    expect(deriveRiskScore([finding({ severity: 'high' })], [], [])).toBe(30);
    expect(deriveRiskScore([finding({ severity: 'medium' })], [], [])).toBe(15);
    expect(deriveRiskScore([finding({ severity: 'info' })], [], [])).toBe(5);
  });

  it('sums findings, coverage gaps and red flags', () => {
    const score = deriveRiskScore(
      [finding({ severity: 'high' }), finding({ severity: 'medium' })],
      [{ medicineName: '手录药', reason: 'manualEntry' }],
      [{ rule: 'informationGap', primaryMedicineName: '手录药' }],
    );
    // 30 + 15 + 3 + 10
    expect(score).toBe(58);
  });

  it('weighs a severe allergy above any single finding', () => {
    const severe = deriveRiskScore(
      [],
      [],
      [{ rule: 'severeAllergy', primaryMedicineName: '青霉素' }],
    );
    const high = deriveRiskScore([finding({ severity: 'high' })], [], []);
    expect(severe).toBeGreaterThan(high);
  });

  it('saturates at 100 rather than growing without bound', () => {
    const many = Array.from({ length: 10 }, () =>
      finding({ severity: 'high' }),
    );
    expect(deriveRiskScore(many, [], [])).toBe(100);
  });

  it('bands the score at the documented boundaries', () => {
    expect(levelForScore(0)).toBe('safe');
    expect(levelForScore(10)).toBe('safe');
    expect(levelForScore(11)).toBe('caution');
    expect(levelForScore(40)).toBe('caution');
    expect(levelForScore(41)).toBe('risk');
    expect(levelForScore(70)).toBe('risk');
    expect(levelForScore(71)).toBe('danger');
    expect(levelForScore(100)).toBe('danger');
  });
});

describe('risk-finding severity ladder', () => {
  it('orders high above medium above info', () => {
    expect(highestSeverity([finding({ severity: 'info' })])).toBe('info');
    expect(
      highestSeverity([
        finding({ severity: 'info' }),
        finding({ severity: 'high' }),
      ]),
    ).toBe('high');
    expect(
      highestSeverity([
        finding({ severity: 'medium' }),
        finding({ severity: 'high' }),
        finding({ severity: 'info' }),
      ]),
    ).toBe('high');
  });

  it('returns null for no findings, distinct from info', () => {
    expect(highestSeverity([])).toBeNull();
  });

  it('treats info as not noteworthy and the other rungs as noteworthy', () => {
    expect(isNoteworthySeverity('info')).toBe(false);
    expect(isNoteworthySeverity('medium')).toBe(true);
    expect(isNoteworthySeverity('high')).toBe(true);
  });

  it('filters out info findings', () => {
    const findings = [
      finding({ severity: 'info' }),
      finding({ severity: 'medium' }),
      finding({ severity: 'high' }),
    ];
    expect(noteworthyFindings(findings)).toHaveLength(2);
    expect(
      noteworthyFindings(findings).every((f) => f.severity !== 'info'),
    ).toBe(true);
  });
});

describe('completeStaticAssessment', () => {
  it('derives score and level from the findings instead of trusting a caller', () => {
    const outcome = completeStaticAssessment(
      input({
        // A deliberately wrong level/score on the result: the aggregate must
        // ignore them and derive its own.
        result: result({
          findings: [
            finding({ severity: 'high' }),
            finding({ severity: 'high' }),
          ],
          overallRiskLevel: 'safe',
          overallRiskScore: 0,
          checkedMedicineCount: 1,
        }),
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.assessment.riskScore).toBe(60);
    expect(outcome.assessment.riskLevel).toBe('risk');
  });

  it('is deterministic for the same input', () => {
    const build = () =>
      completeStaticAssessment(
        input({
          result: result({ findings: [finding({ severity: 'medium' })] }),
        }),
      );

    const first = build();
    const second = build();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.assessment.riskScore).toBe(second.assessment.riskScore);
    expect(first.assessment.riskLevel).toBe(second.assessment.riskLevel);
  });

  it('stamps the check kind and copies the medicine ids', () => {
    const ids = ['m1', 'm2'];
    const outcome = completeStaticAssessment(input({ medicineIds: ids }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.assessment.checkType).toBe('static');
    expect(outcome.assessment.medicineIds).toEqual(ids);
    // Copied, not aliased: later mutation of the caller's array must not
    // rewrite what the aggregate recorded.
    expect(outcome.assessment.medicineIds).not.toBe(ids);
  });
});

describe('coverage identity (unresolved medicines must not vanish)', () => {
  it('accepts a result where every medicine is checked or reported uncovered', () => {
    const outcome = completeStaticAssessment(
      input({
        result: result({
          checkedMedicineCount: 2,
          coverageIssues: [
            { medicineName: '手录药', reason: 'manualEntry' },
            { medicineName: '缺引用', reason: 'missingSourceRef' },
          ],
        }),
      }),
    );
    expect(outcome.ok).toBe(true);
  });

  it('rejects a result that silently drops an unresolved medicine', () => {
    const outcome = completeStaticAssessment(
      input({
        result: {
          overallRiskLevel: 'safe',
          overallRiskScore: 0,
          // Three medicines on the box, one checked, none reported uncovered:
          // two vanished, so the assessment must not be formed.
          currentMedicineCount: 3,
          checkedMedicineCount: 1,
          findings: [],
          coverageIssues: [],
          redFlags: [],
        },
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.violation).toEqual({
      kind: 'coverageMismatch',
      currentMedicineCount: 3,
      checkedMedicineCount: 1,
      coverageIssueCount: 0,
    });
  });

  it('rejects the same gap on the LLM path too', () => {
    const outcome = completeLlmAssessment(
      input({
        result: {
          overallRiskLevel: 'safe',
          overallRiskScore: 0,
          currentMedicineCount: 2,
          checkedMedicineCount: 2,
          findings: [],
          coverageIssues: [{ medicineName: 'x', reason: 'manualEntry' }],
          redFlags: [],
        },
      }),
    );
    expect(outcome.ok).toBe(false);
  });
});

describe('completeLlmAssessment', () => {
  it('takes the model score but still range-checks it', () => {
    const outcome = completeLlmAssessment(
      input({
        result: result({
          overallRiskScore: 55,
          overallRiskLevel: 'risk',
        }),
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.assessment.checkType).toBe('llm');
    expect(outcome.assessment.riskScore).toBe(55);
    expect(outcome.assessment.riskLevel).toBe('risk');
  });

  it('rejects an out-of-range score', () => {
    for (const score of [-1, 101, 1.5, Number.NaN]) {
      const outcome = completeLlmAssessment(
        input({ result: result({ overallRiskScore: score }) }),
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.violation.kind).toBe('scoreOutOfRange');
    }
  });
});

describe('noteworthyFindingCount', () => {
  it('counts warnings but not informational notes', () => {
    const outcome = completeStaticAssessment(
      input({
        result: result({
          findings: [
            finding({ severity: 'high' }),
            finding({ severity: 'medium' }),
            finding({ severity: 'info' }),
            finding({ severity: 'info' }),
          ],
        }),
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.assessment.noteworthyFindingCount).toBe(2);
  });
});
