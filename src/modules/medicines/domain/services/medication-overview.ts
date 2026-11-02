/**
 * 用药全景：把「当前在吃什么」从一组条目变成一个可分析的集合。
 *
 * ## 这层要回答的问题
 *
 * 现有 `/user/health-context` 返回的是**条目列表**：一行一个药、一行一个剂量。
 * 这是处方视角，而患者真实的用药状况是**多科室、多时间、自己加购**的叠加结果——
 * 心内科开的抗凝、骨科开的止痛、自己买的胃药。三个医生谁都看不到全貌。
 *
 * 所以这一层要回答三个「条目列表看不出来」的问题：
 *
 * 1. **同一成分吃了几份**（不同商品名、同一化合物）；
 * 2. **这些药在药理学上交汇在哪**（共同靶点、共同代谢酶）；
 * 3. **哪些来源叠加了**（有 `healthEventId` 时按事件分组）。
 *
 * ## 为什么聚合是纯函数
 *
 * 输入是已经解析好的药品事实，输出是分组与结论。把它写成纯函数意味着：
 * 不连库就能测「两个不同商品名是否被判为重复」这类核心断言，
 * 而重数据库和图的步骤留在调用方。
 */

/** 一条在服药品的最小事实（已从 `UserCurrentMedicine` + 药品详情解析而来）。 */
export interface MedicationFact {
  /** `UserCurrentMedicine.id`，用于回指原条目。 */
  readonly entryId: string;
  readonly displayName: string;
  /** DrugBank id；CN 源或手动录入为 null。 */
  readonly drugbankId: string | null;
  /** 归一化后的成分键（来自 `getCanonicalIngredientKeys`）。 */
  readonly ingredientKeys: readonly string[];
  /**
   * 关联的健康事件 id（记录「为什么在吃这个」）。
   *
   * 是**数组**：HealthEventMedicine 是 @@unique([eventId, currentMedicineId])，
   * 一个药可以同时挂在多个事件下（不同病程、不同来源）。用单值会把这种叠加
   * 情况掩盖掉，而「同一个药被两条病程同时关联」本身就是要看的信号。
   */
  readonly healthEventIds: readonly string[];
}

/** 一组共享同一成分的药品。 */
export interface DuplicateIngredientGroup {
  /** 共享的成分键。 */
  readonly ingredientKey: string;
  /** 涉及条目的 id。 */
  readonly entryIds: readonly string[];
  /** 涉及条目的显示名。 */
  readonly displayNames: readonly string[];
  /**
   * 严重度：`high` 表示**同一成分出现 3 次及以上**或涉及不同源（CN + DrugBank），
   * `medium` 表示 2 次。重复用药本身就是风险，而次数越多越可能是意外。
   */
  readonly severity: 'medium' | 'high';
}

/** 按来源事件分组的用药叠加。 */
export interface SourceOverlap {
  /** 健康事件 id，或 `unattributed`（没有关联事件的条目）。 */
  readonly source: string;
  readonly medicineCount: number;
  readonly displayNames: readonly string[];
}

/**
 * 全景结果。
 *
 * `duplicates` 与 `sourceOverlaps` 都**不依赖图**，只要药品详情可解析就能给出；
 * 图相关的部分（共同靶点、酶重叠）在调用方另行补充，失败时不影响这两项。
 */
export interface MedicationOverview {
  readonly totalMedicines: number;
  /** 已成功解析出成分的条目数；其余在图上/成分上无法参与分析。 */
  readonly resolvableMedicines: number;
  readonly duplicates: readonly DuplicateIngredientGroup[];
  readonly sourceOverlaps: readonly SourceOverlap[];
}

/** 同一成分出现多少次算「高危重复」。 */
const HIGH_SEVERITY_DUPLICATE_COUNT = 3;

/** 没有关联健康事件的条目在 `sourceOverlaps` 里的分组键。 */
const UNATTRIBUTED_SOURCE = 'unattributed';

/**
 * 聚合出重复成分分组。
 *
 * ## 为什么按「成分键」而不是药名
 *
 * 患者看到的是商品名（「芬必得」「布洛芬缓释胶囊」），而重复用药的判定依据是
 * **成分**。按药名比对永远发现不了「两种不同商品名、同一成分」——而这正是
 * 患者自己加购时最常见的重复场景，也是这个功能存在的理由。
 *
 * @param facts 已解析的用药条目。没有成分键的条目会被跳过（无法参与判定）。
 */
export function findDuplicateIngredients(
  facts: readonly MedicationFact[],
): DuplicateIngredientGroup[] {
  const byKey = new Map<string, MedicationFact[]>();
  for (const fact of facts) {
    for (const key of fact.ingredientKeys) {
      const bucket = byKey.get(key);
      if (bucket === undefined) byKey.set(key, [fact]);
      else if (!bucket.some((existing) => existing.entryId === fact.entryId))
        bucket.push(fact);
    }
  }

  const groups: DuplicateIngredientGroup[] = [];
  for (const [ingredientKey, entries] of byKey) {
    // 单条目不算重复：那只是「你在吃这个成分」。
    if (entries.length < 2) continue;

    const entryIds = entries.map((entry) => entry.entryId);
    groups.push({
      ingredientKey,
      entryIds,
      displayNames: entries.map((entry) => entry.displayName),
      severity: duplicateSeverity(entries),
    });
  }

  // 严重度降序、条目多的优先：界面第一眼看的是最该处理的。
  return groups.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      b.entryIds.length - a.entryIds.length,
  );
}

/**
 * 重复的严重度。
 *
 * 两个判据：
 * - **次数**：3 次及以上更可能是意外（同成分在不同科室开了两次以上）；
 * - **跨源**：同时来自 CN 与 DrugBank 说明是两套数据里的不同商品，
 *   比同源重复更难被用户察觉。
 */
function duplicateSeverity(
  entries: readonly MedicationFact[],
): 'medium' | 'high' {
  if (entries.length >= HIGH_SEVERITY_DUPLICATE_COUNT) return 'high';
  const hasDrugbank = entries.some((entry) => entry.drugbankId !== null);
  const hasNonDrugbank = entries.some((entry) => entry.drugbankId === null);
  return hasDrugbank && hasNonDrugbank ? 'high' : 'medium';
}

function severityRank(severity: 'medium' | 'high'): number {
  return severity === 'high' ? 1 : 0;
}

/**
 * 按来源事件分组，看用药是否叠加。
 *
 * 有 `healthEventId` 的条目按事件归组；没有的归到 `unattributed`。
 * 这个分组的价值在于回答「这几个药是同一个病程开的，还是不同时期自己加的」——
 * 后者更值得提示，因为没有任何一个医生在统筹。
 */
export function groupBySource(
  facts: readonly MedicationFact[],
): SourceOverlap[] {
  const bySource = new Map<string, MedicationFact[]>();
  for (const fact of facts) {
    // 多头关联的条目在每个事件下各计一次：它确实同时属于这些病程。
    const keys =
      fact.healthEventIds.length > 0
        ? fact.healthEventIds
        : [UNATTRIBUTED_SOURCE];
    for (const key of keys) {
      const bucket = bySource.get(key);
      if (bucket === undefined) bySource.set(key, [fact]);
      else if (!bucket.some((existing) => existing.entryId === fact.entryId))
        bucket.push(fact);
    }
  }

  return [...bySource.entries()]
    .map(([source, entries]) => ({
      source,
      medicineCount: entries.length,
      displayNames: entries.map((entry) => entry.displayName),
    }))
    .sort(
      (a, b) =>
        b.medicineCount - a.medicineCount || a.source.localeCompare(b.source),
    );
}

/**
 * 把一批事实聚合成全景。
 *
 * @param facts 已解析的用药条目（可能包含无法解析成分的条目）。
 */
export function buildMedicationOverview(
  facts: readonly MedicationFact[],
): MedicationOverview {
  const resolvable = facts.filter((fact) => fact.ingredientKeys.length > 0);

  return {
    totalMedicines: facts.length,
    resolvableMedicines: resolvable.length,
    duplicates: findDuplicateIngredients(facts),
    sourceOverlaps: groupBySource(facts),
  };
}
