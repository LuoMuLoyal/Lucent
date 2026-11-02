import type {
  MedicineRiskFinding,
  MedicineRiskMechanism,
  MedicineRiskMechanismOutcome,
} from './risk-model.js';
import type {
  MechanismPath,
  RelationQueryOutcome,
} from '../../domain/relations/relation.js';

/**
 * 把「两药之间的机制通路」翻译成风险发现上的图证据。
 *
 * ## 为什么这层值得单独存在
 *
 * 图查询返回的是 `MechanismPath`（酶 + 另一端药物 + 边类型），而界面要的是
 * 「这条冲突为什么发生」。两者之间的关系是**映射**而不是直接展示，
 * 而且有一堆边界情况：没有通路、图不可用、通路指向别的药。
 * 把它写成纯函数就能把这些分支全部单测掉，不必起图库。
 *
 * ## 一条关键约束：只认「本发现涉及的两个药」
 *
 * 多药查询会把所有药两两配对，同一对药可能有多条通路。这里必须过滤到
 * **当前 finding 的主药与副药**，否则会把别处的通路贴到这条发现上——
 * 那是错误归因，比没有机制更糟。
 */

/** 机制证据的条数上限：界面放不下更多，且多到一定程度反而不帮助判断。 */
const MAX_MECHANISMS_PER_FINDING = 3;

export interface MechanismLookupInput {
  /** 主药的 DrugBank id；没有则为 null（CN 源或手动录入）。 */
  readonly primaryDrugbankId: string | null;
  /** 副药的 DrugBank id。 */
  readonly secondaryDrugbankId: string | null;
}

/**
 * @param lookup 该次风险检查**一次性**取回的全部通路（多药查询的结果）。
 * @param input 当前 finding 对应的两个药。
 */
export function buildMechanismOutcome(
  lookup: RelationQueryOutcome<readonly MechanismPath[]>,
  input: MechanismLookupInput,
): MedicineRiskMechanismOutcome {
  // 查询本身失败：如实说明「无法回答」，不要退化成 notFound。
  if (!lookup.ok) {
    return { status: lookup.reason };
  }
  // 两个药至少有一个没有 DrugBank id：图上根本没法查，属于「没有」而不是「查不了」。
  const ids = [input.primaryDrugbankId, input.secondaryDrugbankId];
  if (ids.some((id) => id === null)) {
    return { status: 'notFound' };
  }

  const [primary, secondary] = ids as [string, string];
  const relevant = lookup.value.filter(
    (path) => path.otherDrugId === secondary && path.enzymeGene !== '',
  );

  if (relevant.length === 0) {
    return { status: 'notFound' };
  }

  // 同一酶可能同时以 INHIBITS 与 INDUCES 出现（不同来源行）；按酶去重，
  // 优先保留抑制——抑制导致浓度升高，是这类冲突的主要方向。
  const byGene = new Map<string, MedicineRiskMechanism>();
  for (const path of relevant) {
    const existing = byGene.get(path.enzymeGene);
    if (
      existing === undefined ||
      betterRelation(path.relation, existing.relation)
    ) {
      byGene.set(path.enzymeGene, {
        kind: 'enzyme',
        geneSymbol: path.enzymeGene,
        entityName: path.enzymeName,
        relation: path.relation,
      });
    }
  }

  // 防御 `primary` 未使用：上面的配对里 primary 由查询参数限定，
  // 这里显式断言避免 lint 认为它多余（同时让意图可读）。
  void primary;

  return {
    status: 'ok',
    mechanisms: [...byGene.values()].slice(0, MAX_MECHANISMS_PER_FINDING),
  };
}

/** `INHIBITS` 比 `INDUCES` 更能说明「浓度升高」型冲突。 */
function betterRelation(candidate: string, current: string): boolean {
  return candidate === 'INHIBITS' && current !== 'INHIBITS';
}

/**
 * 给一批 finding 挂上机制证据。
 *
 * 只处理 `interaction` 类：其他类型（重复成分、过敏、食物相互作用）不来自图，
 * 硬套一条「机制」是编造。
 *
 * @param findings 风险检测的原始发现。
 * @param drugbankIds 每个发现对应的两个药的 DrugBank id，按 `evidence` 键匹配。
 * @param lookup 一次多药查询的结果（所有药两两之间的通路）。
 */
export function attachMechanisms(
  findings: readonly MedicineRiskFinding[],
  drugbankIds: ReadonlyMap<string, MechanismLookupInput>,
  lookup: RelationQueryOutcome<readonly MechanismPath[]>,
): MedicineRiskFinding[] {
  return findings.map((finding) => {
    if (finding.type !== 'interaction') return finding;

    const input = drugbankIds.get(findingKey(finding));
    if (input === undefined)
      return { ...finding, mechanism: { status: 'notFound' } };

    return { ...finding, mechanism: buildMechanismOutcome(lookup, input) };
  });
}

/**
 * 发现 → 查表键。
 *
 * 用两个药名拼键而不是索引：finding 数组可能被后续步骤过滤/重排，
 * 按下标对齐会在某次改动后静默错位。
 */
export function findingKey(finding: MedicineRiskFinding): string {
  const primary = finding.primaryMedicineName;
  const secondary = finding.secondaryMedicineName ?? '';
  return `${primary}::${secondary}`;
}
