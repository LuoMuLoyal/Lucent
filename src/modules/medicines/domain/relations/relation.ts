/**
 * Drug relation domain vocabulary.
 *
 * Pure domain: no Prisma, no Neo4j, no zod. The graph topology lives in Neo4j
 * (`semantica-service`'s export) but the application layer must not learn Neo4j
 * types — it works with these values, and `infrastructure/graph/relations.ts`
 * maps rows onto them.
 *
 * ## 为什么关系类型是受控词表而不是自由字符串
 *
 * Neo4j 里的边类型来自 DrugBank 的 `relationKind` 映射，是一组固定的语义边
 * （`INHIBITS` / `SUBSTRATE_OF` / …）。把这些值当自由字符串传递，会让
 * 「拼错一个边名就静默查到空」变成最常见也最难查的缺陷——
 * 声明成联合类型后，拼错是编译错误。
 *
 * 未知边（上游新增了关系类型）必须走 {@link resolveRelationKind} 归一为
 * `unknown` 并**保留原始标签**，而不是丢弃：丢弃等于「图上有什么」这件事
 * 对调用方不可见，而可溯源正是这个模块的产品前提。
 */

/** 与 CYP/靶点相关的机制边（方向一的核心）。 */
export const DRUG_RELATION_KINDS = [
  'inhibits',
  'induces',
  'substrateOf',
  'actsOn',
  'interactsWith',
  'carriedBy',
  'transportedBy',
] as const;

export type DrugRelationKind = (typeof DRUG_RELATION_KINDS)[number];

/** 本模块未识别的上游关系类型。 */
export const UNKNOWN_RELATION_KIND = 'unknown';

export type DrugRelationKindOrUnknown =
  | DrugRelationKind
  | typeof UNKNOWN_RELATION_KIND;

/** Neo4j 边标签 → 领域关系类型。 */
const KIND_BY_LABEL: Readonly<Record<string, DrugRelationKind>> = {
  INHIBITS: 'inhibits',
  INDUCES: 'induces',
  SUBSTRATE_OF: 'substrateOf',
  ACTS_ON: 'actsOn',
  INTERACTS_WITH: 'interactsWith',
  CARRIED_BY: 'carriedBy',
  TRANSPORTED_BY: 'transportedBy',
};

/** 图上的节点类型。 */
export const DRUG_RELATION_NODE_KINDS = [
  'drug',
  'protein',
  'atcClass',
] as const;
export type DrugRelationNodeKind = (typeof DRUG_RELATION_NODE_KINDS)[number];

/**
 * 边方向的语义。
 *
 * ## 为什么方向要显式建模
 *
 * 图中同一个关系并非都是「药物 → 蛋白」：`SUBSTRATE_OF` 是药物被某酶代谢，
 * `INTERACTS_WITH` 是双向的。统一画成箭头会把「谁作用于谁」讲反——
 * 在用药安全场景下，讲反方向和讲错结论一样危险。
 *
 * `symmetric` 表示语义上无方向（相互作用），展示时不得画成单向箭头。
 */
export type DrugRelationDirection = 'forward' | 'symmetric';

export interface DrugRelationEndpoint {
  /** 节点在图里的业务标识（DrugBank id、UniProt id、基因名等）。 */
  readonly id: string;
  readonly kind: DrugRelationNodeKind;
  readonly name: string;
  /** 基因符号（仅 protein 有），如 `CYP2C9`。 */
  readonly geneName: string | null;
}

export interface DrugRelation {
  readonly from: DrugRelationEndpoint;
  readonly to: DrugRelationEndpoint;
  readonly kind: DrugRelationKindOrUnknown;
  /** 上游原始边标签，`kind` 为 `unknown` 时这是唯一可用信息。 */
  readonly rawKind: string;
  readonly direction: DrugRelationDirection;
  /** 药物在关系里的作用标签，如 `inhibitor` / `substrate`。 */
  readonly actions: readonly string[];
  /** 溯源自证：该边来自哪个导入批次/关系。 */
  readonly provenance: string | null;
}

/**
 * 两药之间的机制通路：`A ─INHIBITS→ 酶 ←SUBSTRATE_OF─ B`。
 *
 * 这是「为什么冲突」的答案形态——不是「A 和 B 有风险」的结论，而是
 * 「A 对某酶做了什么、B 与该酶是什么关系」的事实链。
 */
export interface MechanismPath {
  readonly enzymeGene: string;
  readonly enzymeName: string;
  /** 通路的另一端药物。 */
  readonly otherDrugId: string;
  readonly otherDrugName: string;
  /** 起始药物对该酶的作用（`INHIBITS` / `INDUCES`）。 */
  readonly relation: string;
}

/**
 * 共同靶点：这组药在图上交汇的地方。
 *
 * `drugIds` / `drugNames` 一起返回，是因为「有几个药在打这个靶点」与「是哪几个」
 * 是这份数据的主要价值——只给计数会让界面再查一次。
 */
export interface SharedTarget {
  readonly targetGene: string;
  readonly targetName: string;
  readonly drugCount: number;
  readonly drugIds: readonly string[];
  readonly drugNames: readonly string[];
}

/**
 * 4 跳代谢级联。
 *
 * `A 抑制酶1 → C 是酶1底物且抑制酶2 → B 是酶2底物`：A 与 B 没有直接相互作用，
 * 但 A 通过 C 间接改变了 B 的暴露量。这是平铺相互作用表**结构上无法表达**的，
 * 也是这条图查询链路最直接的价值证明。
 */
export interface CascadePath {
  readonly startDrug: string;
  readonly enzymeOne: string;
  readonly middleDrug: string;
  readonly enzymeTwo: string;
  readonly endDrug: string;
}

/**
 * 替代候选。
 *
 * 刻意**不含**「推荐」「更适合」这类字段：它表达的是「药理上不走该酶」这一
 * 结构事实，不是临床结论。
 */
export interface SubstituteCandidate {
  readonly drugbankId: string;
  readonly name: string;
  /** 与目标药共享的靶点基因名（排除理由的证据）。 */
  readonly sharedTarget: string | null;
}

/** 单药作用谱的一行。 */
export interface DrugAction {
  readonly targetGene: string;
  readonly targetName: string;
  readonly relation: string;
  readonly actions: readonly string[];
}

/**
 * 两药之间的最短传播路径。
 *
 * `pathNodes` / `pathRelations` 逐位对应（节点 n 与边 n），
 * 保证界面可以据此画出这条链，而不是只看到一个步数。
 */
export interface ShortestRoute {
  readonly stepCount: number;
  readonly pathNodes: readonly string[];
  readonly pathRelations: readonly string[];
}

/** 靶点视角的一行：某药作用于该靶点的方式。 */
export interface TargetDrug {
  readonly drugbankId: string;
  readonly name: string;
  readonly relation: string;
}

/**
 * 转运体路径。
 *
 * `inverted` 为 true 表示边方向与「药物 → 转运体」相反（药物是终点），
 * 展示时不能画成同向箭头——方向讲反和讲错结论一样危险。
 */
export interface TransportRoute {
  readonly transporterGene: string;
  readonly transporterName: string;
  readonly inverted: boolean;
}

/**
 * 酶诱导 × 底物拮抗。
 *
 * 诱导剂让酶变多、底物药被代谢得更快，浓度**下降**。这类间接相互作用在
 * 平铺关系表里通常只写成「有相互作用」，看不出方向相反。
 */
export interface EnzymeDuel {
  readonly enzymeGene: string;
  readonly inducerDrug: string;
  readonly inhibitedSubstrate: string;
}

/**
 * 一条关系查询的失败原因。
 *
 * ## 为什么失败要区分而不是统一成「查不到」
 *
 * 「图服务连不上」与「图上确实没有这条关系」对调用方的意义完全相反：
 * 前者是**我们无法回答**，后者是**答案是「没有」**。把两者合流成空数组，
 * 会让界面把「知识缺口」显示成「安全」，这正是用药场景里最危险的静默降级。
 */
export const RELATION_QUERY_FAILURE_REASONS = [
  'notConfigured',
  'unavailable',
  'timeout',
] as const;

export type RelationQueryFailureReason =
  (typeof RELATION_QUERY_FAILURE_REASONS)[number];

export interface RelationQueryFailure {
  readonly ok: false;
  readonly reason: RelationQueryFailureReason;
}

export interface RelationQuerySuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type RelationQueryOutcome<T> =
  | RelationQuerySuccess<T>
  | RelationQueryFailure;

/**
 * 把上游边标签归一成受控类型。
 *
 * @param label Neo4j 边标签，可能带前缀/大小写差异。
 * @returns 已知类型，或 `unknown`（此时调用方仍持有 `rawKind`）。
 */
export function resolveRelationKind(label: string): DrugRelationKindOrUnknown {
  return KIND_BY_LABEL[label.trim().toUpperCase()] ?? UNKNOWN_RELATION_KIND;
}

/**
 * 边方向。
 *
 * `INTERACTS_WITH` 是唯一对称关系；其余都是「有起点」的断言。
 */
export function resolveRelationDirection(
  kind: DrugRelationKindOrUnknown,
): DrugRelationDirection {
  return kind === 'interactsWith' ? 'symmetric' : 'forward';
}
