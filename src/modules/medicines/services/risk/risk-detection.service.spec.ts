import { describe, expect, it } from 'vitest';
import { RiskDetectionService } from './risk-detection.service';
import type { MedicineDetailWrapper } from '../../utils/ingredient-canonicalization';
import type { AllergyRecord } from '../../utils/allergy-severity';

const svc = new RiskDetectionService();

function med(
  overrides: {
    source?: 'cn' | 'drugbank';
    name?: string;
    displayName?: string;
    sourceRefId?: string | null;
    detail?: Record<string, unknown>;
  } = {},
): MedicineDetailWrapper {
  return {
    item: {
      id: overrides.sourceRefId ?? 'm1',
      source: overrides.source ?? 'cn',
      sourceRefId: overrides.sourceRefId ?? 'm1',
      displayName: overrides.displayName ?? overrides.name ?? 'TestMed',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    detail: {
      id: 'd',
      source: overrides.source ?? 'cn',
      name: overrides.name ?? 'TestMed',
      detail: overrides.detail ?? {},
    } as unknown as MedicineDetailWrapper['detail'],
  };
}

const allergy = (overrides: Partial<AllergyRecord> = {}): AllergyRecord => ({
  label: '对乙酰氨基酚',
  reaction: null,
  severity: null,
  isActive: true,
  ...overrides,
});

describe('RiskDetectionService.evaluateStaticRisk', () => {
  it('returns safe/0 for empty inputs', () => {
    const result = svc.evaluateStaticRisk([], [], []);
    expect(result.riskScore).toBe(0);
    expect(result.riskLevel).toBe('safe');
    expect(result.findings).toEqual([]);
    expect(result.coverageIssues).toEqual([]);
    expect(result.redFlags).toEqual([]);
  });

  it('caps risk score at 100 and maps level boundaries', () => {
    const manyHigh = Array.from({ length: 10 }, (_, i) =>
      med({
        name: `Med${i}`,
        sourceRefId: `m${i}`,
        detail: { foodInteractions: ['alcohol'] },
      }),
    );
    // 每个酒精相互作用 medium +15 → 10*15 = 150 → cap 100
    const result = svc.evaluateStaticRisk(manyHigh, [], []);
    expect(result.riskScore).toBe(100);
    expect(result.riskLevel).toBe('danger');
  });

  it('maps score levels across safe/caution/risk/danger boundaries', () => {
    const singleAlcohol = svc.evaluateStaticRisk(
      [med({ detail: { foodInteractions: ['alcohol'] } })],
      [],
      [],
    );
    expect(singleAlcohol.riskScore).toBe(15); // medium → caution
    expect(singleAlcohol.riskLevel).toBe('caution');

    // interaction(high +30) + 两个 alcohol(medium +15*2) = 60 → risk
    const a = med({
      source: 'drugbank',
      sourceRefId: 'DB_A',
      name: 'A',
      detail: {
        drugInteractions: [{ drugbankId: 'DB_B', description: 'x' }],
        foodInteractions: ['alcohol'],
      },
    });
    const b = med({
      source: 'drugbank',
      sourceRefId: 'DB_B',
      name: 'B',
      detail: { foodInteractions: ['alcohol'] },
    });
    const twoHigh = svc.evaluateStaticRisk([a, b], [], []);
    expect(twoHigh.riskScore).toBe(60);
    expect(twoHigh.riskLevel).toBe('risk');
  });

  it('produces allergy findings via token match on cn ingredients', () => {
    const result = svc.evaluateStaticRisk(
      [med({ detail: { ingredients: '对乙酰氨基酚 500mg' } })],
      [allergy()],
      [],
    );
    const f = result.findings.find((x) => x.type === 'allergy');
    expect(f).toBeDefined();
    expect(f?.relatedLabel).toBe('对乙酰氨基酚');
    expect(f?.severity).toBe('high'); // unknown severity → high
  });

  it('maps allergy severity: moderate → medium, mild → info, severe → high', () => {
    const caseSeverity = (a: AllergyRecord): string | undefined =>
      svc
        .evaluateStaticRisk(
          [med({ detail: { ingredients: a.label } })],
          [a],
          [],
        )
        .findings.find((x) => x.type === 'allergy')?.severity;

    expect(
      caseSeverity(allergy({ label: '青霉素', severity: 'moderate' })),
    ).toBe('medium');
    expect(caseSeverity(allergy({ label: '青霉素', severity: 'mild' }))).toBe(
      'info',
    );
    expect(caseSeverity(allergy({ label: '青霉素', severity: 'severe' }))).toBe(
      'high',
    );
  });

  it('detects alcohol and caffeine food interactions', () => {
    const result = svc.evaluateStaticRisk(
      [
        med({
          detail: {
            foodInteractions: ['Avoid alcohol', '咖啡因敏感', 'plain'],
          },
        }),
      ],
      [],
      [],
    );
    const alcohol = result.findings.find((x) => x.context === 'alcohol');
    const caffeine = result.findings.find((x) => x.context === 'caffeine');
    expect(alcohol?.severity).toBe('medium');
    expect(caffeine?.severity).toBe('info');
  });

  it('detects pair interaction when A targets B', () => {
    const a = med({
      source: 'drugbank',
      sourceRefId: 'DB_A',
      name: 'DrugA',
      detail: {
        drugInteractions: [{ drugbankId: 'DB_B', description: 'avoid combo' }],
      },
    });
    const b = med({ source: 'drugbank', sourceRefId: 'DB_B', name: 'DrugB' });
    const forward = svc.evaluateStaticRisk([a, b], [], []);
    const f = forward.findings.find((x) => x.type === 'interaction');
    expect(f?.primaryMedicineName).toBe('DrugA');
    expect(f?.secondaryMedicineName).toBe('DrugB');
    expect(f?.evidence).toBe('avoid combo');
  });

  it('detects reverse pair interaction when only B targets A', () => {
    // A 的 interaction 目标与 B 无关，只有 B 指向 A → 走反向分支
    const a = med({
      source: 'drugbank',
      sourceRefId: 'DB_A',
      name: 'DrugA',
      detail: { drugInteractions: [{ drugbankId: 'DB_X', description: 'x' }] },
    });
    const b = med({
      source: 'drugbank',
      sourceRefId: 'DB_B',
      name: 'DrugB',
      detail: { drugInteractions: [{ drugbankId: 'DB_A', description: 'y' }] },
    });
    const reverse = svc.evaluateStaticRisk([a, b], [], []);
    const r = reverse.findings.find((x) => x.type === 'interaction');
    expect(r?.primaryMedicineName).toBe('DrugB');
    expect(r?.secondaryMedicineName).toBe('DrugA');
    expect(r?.evidence).toBe('y');
  });

  it('detects duplicate ingredients via canonical keys', () => {
    const a = med({
      name: '泰诺',
      detail: { ingredients: '对乙酰氨基酚 500mg' },
    });
    const b = med({
      name: '散利痛',
      sourceRefId: 'm2',
      detail: { ingredients: '扑热息痛 250mg' },
    });
    const result = svc.evaluateStaticRisk([a, b], [], []);
    const f = result.findings.find((x) => x.type === 'duplicateIngredient');
    expect(f?.primaryMedicineName).toBe('泰诺');
    expect(f?.secondaryMedicineName).toBe('散利痛');
    expect(f?.evidence).toContain('acetaminophen');
  });

  it('classifies coverage issues by source', () => {
    const manual = {
      id: 'm1',
      source: 'manual',
      sourceRefId: null,
      displayName: '手录药',
    };
    const noRef = {
      id: 'm2',
      source: 'cn',
      sourceRefId: '',
      displayName: '缺引用',
    };
    const unresolvable = {
      id: 'm3',
      source: 'cn',
      sourceRefId: 'x',
      displayName: '查不到',
    };
    const result = svc.evaluateStaticRisk(
      [],
      [],
      [manual, noRef, unresolvable],
    );
    expect(result.coverageIssues).toEqual([
      { medicineName: '手录药', reason: 'manualEntry' },
      { medicineName: '缺引用', reason: 'missingSourceRef' },
      { medicineName: '查不到', reason: 'detailUnavailable' },
    ]);
  });

  it('raises severeAllergy and informationGap red flags', () => {
    const severe = allergy({ label: '青霉素', severity: 'severe' });
    const result = svc.evaluateStaticRisk(
      [med({ name: '青霉素V钾', detail: { ingredients: '青霉素' } })],
      [severe],
      [{ id: 'm2', source: 'cn', sourceRefId: '', displayName: '缺引用药' }],
    );
    expect(result.redFlags.some((r) => r.rule === 'severeAllergy')).toBe(true);
    expect(
      result.redFlags.filter((r) => r.rule === 'informationGap').length,
    ).toBeLessThanOrEqual(2);
    expect(result.riskScore).toBeGreaterThanOrEqual(40); // severeAllergy +40
  });

  it('does not raise severeAllergy without an allergy finding', () => {
    const result = svc.evaluateStaticRisk(
      [med({ detail: { ingredients: '布洛芬' } })],
      [allergy({ label: '青霉素', severity: 'severe' })],
      [],
    );
    expect(result.redFlags).toEqual([]);
  });
});
