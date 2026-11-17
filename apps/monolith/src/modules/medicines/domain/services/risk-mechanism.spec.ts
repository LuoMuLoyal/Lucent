import { describe, expect, it } from 'vitest';

import type {
  MechanismPath,
  RelationQueryOutcome,
} from '../relations/relation.js';
import type { MedicineRiskFinding } from './risk-model.js';
import {
  attachMechanisms,
  buildMechanismOutcome,
  findingKey,
} from './risk-mechanism.js';

/**
 * 机制证据映射的边界。
 *
 * 这块值得单独测，因为它的失败模式都是**静默的错误归因**：
 * 把别处的通路贴到这条发现上、把「查不了」说成「没有问题」——
 * 界面照样渲染，用户看不出区别。
 */
const path = (overrides: Partial<MechanismPath> = {}): MechanismPath => ({
  enzymeGene: 'CYP2C9',
  enzymeName: 'Cytochrome P450 2C9',
  otherDrugId: 'DB00004',
  otherDrugName: 'Fluconazole',
  relation: 'INHIBITS',
  ...overrides,
});

const ok = (
  paths: MechanismPath[],
): RelationQueryOutcome<readonly MechanismPath[]> => ({
  ok: true,
  value: paths,
});

const PAIR = { primaryDrugbankId: 'DB00682', secondaryDrugbankId: 'DB00004' };

describe('buildMechanismOutcome', () => {
  it('returns the enzyme chain for the matched pair', () => {
    const outcome = buildMechanismOutcome(ok([path()]), PAIR);

    expect(outcome).toEqual({
      status: 'ok',
      mechanisms: [
        {
          kind: 'enzyme',
          geneSymbol: 'CYP2C9',
          entityName: 'Cytochrome P450 2C9',
          relation: 'INHIBITS',
        },
      ],
    });
  });

  it('ignores paths that belong to a different drug', () => {
    // 多药查询返回的是所有药两两的通路；把别处的通路贴到这条发现上是
    // 错误归因，比没有机制更糟。
    const outcome = buildMechanismOutcome(
      ok([path({ otherDrugId: 'DB99999' })]),
      PAIR,
    );

    expect(outcome).toEqual({ status: 'notFound' });
  });

  it('reports notFound when the graph has no path', () => {
    expect(buildMechanismOutcome(ok([]), PAIR)).toEqual({ status: 'notFound' });
  });

  it('reports the query failure instead of downgrading to notFound', () => {
    // 「图连不上」与「图上确实没有」是不同事实；合并会让界面把知识缺口
    // 显示成「机制上没有冲突」。
    expect(
      buildMechanismOutcome({ ok: false, reason: 'timeout' }, PAIR),
    ).toEqual({
      status: 'timeout',
    });
    expect(
      buildMechanismOutcome({ ok: false, reason: 'notConfigured' }, PAIR),
    ).toEqual({
      status: 'notConfigured',
    });
  });

  it('treats a missing DrugBank id as notFound, not as a failure', () => {
    // CN 源或手动录入的药没有 DrugBank id，图上根本无从查起——
    // 这是确定的「没有」，不是「查不了」。
    const outcome = buildMechanismOutcome(ok([path()]), {
      primaryDrugbankId: null,
      secondaryDrugbankId: 'DB00004',
    });

    expect(outcome).toEqual({ status: 'notFound' });
  });

  it('deduplicates by enzyme and prefers INHIBITS over INDUCES', () => {
    // 同一个酶可能以两种关系出现（不同来源行）。抑制导致浓度升高，
    // 是这类冲突的主要方向，保留它更有解释力。
    const outcome = buildMechanismOutcome(
      ok([path({ relation: 'INDUCES' }), path({ relation: 'INHIBITS' })]),
      PAIR,
    );

    expect(outcome).toMatchObject({ status: 'ok' });
    if (outcome.status !== 'ok') throw new Error('unreachable');
    expect(outcome.mechanisms).toHaveLength(1);
    expect(outcome.mechanisms[0]?.relation).toBe('INHIBITS');
  });

  it('caps the number of mechanisms per finding', () => {
    const many = ['CYP2C9', 'CYP3A4', 'CYP2D6', 'CYP1A2', 'CYP2C19'].map(
      (gene) => path({ enzymeGene: gene }),
    );

    const outcome = buildMechanismOutcome(ok(many), PAIR);

    expect(outcome).toMatchObject({ status: 'ok' });
    if (outcome.status !== 'ok') throw new Error('unreachable');
    expect(outcome.mechanisms.length).toBeLessThanOrEqual(3);
  });

  it('drops paths without an enzyme gene symbol', () => {
    // 没有 gene_name 的蛋白无法说明「经哪个酶」，展示出来只是噪音。
    const outcome = buildMechanismOutcome(ok([path({ enzymeGene: '' })]), PAIR);

    expect(outcome).toEqual({ status: 'notFound' });
  });
});

describe('attachMechanisms', () => {
  const finding = (
    overrides: Partial<MedicineRiskFinding> = {},
  ): MedicineRiskFinding => ({
    type: 'interaction',
    severity: 'high',
    context: 'none',
    primaryMedicineName: 'Warfarin',
    secondaryMedicineName: 'Fluconazole',
    ...overrides,
  });

  it('attaches mechanisms only to interaction findings', () => {
    // 重复成分、过敏、食物相互作用不来自图，硬套一条「机制」是编造。
    const findings = [
      finding(),
      finding({ type: 'allergy', secondaryMedicineName: undefined }),
      finding({ type: 'duplicateIngredient' }),
    ];
    const ids = new Map([
      [findingKey(findings[0]!), PAIR],
      [findingKey(findings[1]!), PAIR],
      [findingKey(findings[2]!), PAIR],
    ]);

    const [withMechanism, allergy, duplicate] = attachMechanisms(
      findings,
      ids,
      ok([path()]),
    );

    expect(withMechanism?.mechanism).toMatchObject({ status: 'ok' });
    expect(allergy?.mechanism).toBeUndefined();
    expect(duplicate?.mechanism).toBeUndefined();
  });

  it('marks interaction findings with no id mapping as notFound', () => {
    const [result] = attachMechanisms([finding()], new Map(), ok([path()]));

    expect(result?.mechanism).toEqual({ status: 'notFound' });
  });

  it('keys findings by drug names, not by array position', () => {
    // 按下标对齐会在某次改动后静默错位——这类 bug 不会报错，只会给出错误归因。
    const a = finding({ primaryMedicineName: 'A', secondaryMedicineName: 'B' });
    const b = finding({ primaryMedicineName: 'C', secondaryMedicineName: 'D' });

    expect(findingKey(a)).toBe('A::B');
    expect(findingKey(b)).toBe('C::D');
    expect(findingKey(a)).not.toBe(findingKey(b));
  });
});
