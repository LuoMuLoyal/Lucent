/**
 * 单药邻域图（`GET /medicines/:id/network`）的**限流规则**。
 *
 * ## 为什么限流规则属于领域，不属于查询
 *
 * 「画多少个邻居」看起来是展示问题，实际上是**数据可信度**问题：
 *
 * - 实测单药相互作用度数中位数 **542**、`DB00176` 达 **2,249**、全库最大 **2,637**；
 * - 把它们全画出来是一团毛球，而**截断却不说明截了多少**，就等于让用户
 *   以为「这个药只有 30 个相互作用」——那是撒谎，不是简化。
 *
 * 所以规则是：**取多少、按什么顺序取、截掉多少**必须是一次可单测的纯决策，
 * 而不是散在 SQL 的 `LIMIT` 里。SQL 只负责取，判定在这里。
 *
 * ## 为什么排序不能用「伙伴度数」
 *
 * 初始设计想按「伙伴自己的相互作用数」降序取 Top-N（连越复杂的药越能揭示网络
 * 结构）。实测这条路**不可用**：`DB00176` 的 2,249 个邻居每个都要算一次度数，
 * 单条查询 **757 ms**——它把一个 2 ms 的计数放大成 N 次索引查找（N+1 查询的 SQL 形态）。
 *
 * 因此采用**索引序截断**：按 `interacts_with_id` 升序取前 N。实测同一查询
 * **0.086 ms**（Index Scan 直接流式取前 N，无排序），代价是选择结果依赖药物 id
 * 字典序而非「重要性」。这个取舍写进响应里：`ordering` 字段明确告诉调用方
 * 选中的是「按 id 排序的前 N 个」，而不是「最重要的 N 个」。
 *
 * 诚实地说明排序方式，比假装自己有重要性排序更可取。
 *
 * ## 领域纯度
 *
 * 不 import 任何东西：ADR-0024 要求 `domain/` 不依赖框架、IO 与 zod。
 */

/** 默认返回的邻居节点上限。 */
export const DEFAULT_NEIGHBOUR_LIMIT = 30;

/**
 * 邻居上限的硬顶。
 *
 * 30 是「能读懂」的边界，100 是「还画得动」的边界。超过 100 的请求不是
 * 更深入的探索，而是换一种方式要求全量——那应该由后续的分页/展开接口承担，
 * 不该让单次响应膨胀。
 */
export const MAX_NEIGHBOUR_LIMIT = 100;

/** 默认邻域深度。`1` = 只看直接邻居。 */
export const DEFAULT_NETWORK_DEPTH = 1;

/**
 * 支持的邻域深度。
 *
 * 刻意**只到 1**：`depth=2` 在相互作用图上的规模是二次方——`DB00176` 的
 * 2,249 个邻居各再展开一次就是百万级边，而页面是给一个人读的。
 * 想深入某一支，用「以此为起点重新展开」（换中心节点），而不是一次多跳。
 */
export const SUPPORTED_NETWORK_DEPTHS = [1] as const;
export type NetworkDepth = (typeof SUPPORTED_NETWORK_DEPTHS)[number];

/** 图里的一条边属于哪一类事实。 */
export const NETWORK_EDGE_KINDS = ['interaction', 'target'] as const;
export type NetworkEdgeKind = (typeof NETWORK_EDGE_KINDS)[number];

/** 一个邻居节点。 */
export interface NetworkNeighbour {
  /** 邻接实体的标识：药物是 DrugBank id，靶点是靶点 id。 */
  readonly id: string;
  /** 展示名。 */
  readonly name: string;
  /** 节点类型，决定画布上的形状与图例分组。 */
  readonly nodeKind: 'drug' | 'protein';
  /**
   * 该邻居是否在本地药品库内。
   *
   * 相互作用伙伴可能已被 DrugBank 下线而不在 `drugbank_drugs` 里（该表
   * 刻意不建外键）。**库外的节点只能显示名称、不能跳转**——给一个点了
   * 会 404 的链接比不给链接更糟。
   */
  readonly inCatalogue: boolean;
}

/** 中心与邻居之间的一条边。 */
export interface NetworkEdge {
  readonly kind: NetworkEdgeKind;
  /** 邻接实体标识，对应 {@link NetworkNeighbour.id}。 */
  readonly neighbourId: string;
  /** 靶点边的关系类型（`target` / `enzyme` / `carrier` / `transporter`）。 */
  readonly relationKind: string | null;
  /** 靶点边的作用方式（inhibitor / agonist …）。 */
  readonly actions: readonly string[];
}

/** 中心节点的**真实**度数——来自 `count(*)`，不是截断后的数组长度。 */
export interface NetworkDegree {
  /** 相互作用对象总数（库内 + 库外）。 */
  readonly interactions: number;
  /** 靶点总数。 */
  readonly targets: number;
}

/** 一次邻域查询的完整结果。 */
export interface NetworkGraph {
  readonly center: { readonly id: string; readonly name: string };
  readonly degree: NetworkDegree;
  readonly neighbours: readonly NetworkNeighbour[];
  readonly edges: readonly NetworkEdge[];
  /** 因为上限而未出现在图上的邻居总数。`0` 表示图是完整的。 */
  readonly truncated: number;
  /**
   * 选择的排序方式。
   *
   * 目前恒为 `'drugbank_id_asc'`：见文件头「为什么排序不能用伙伴度数」。
   * 把它放进响应，是为了让界面能如实标注「展示的是前 N 个（按 id）」
   * 而不是暗示「这是最重要的 N 个」。
   */
  readonly ordering: NetworkOrdering;
}

export const NETWORK_ORDERINGS = ['drugbank_id_asc'] as const;
export type NetworkOrdering = (typeof NETWORK_ORDERINGS)[number];

/** 原始查询结果 → 应用限流规则后要返回的东西。 */
export interface NetworkInput {
  readonly center: { readonly id: string; readonly name: string };
  readonly degree: NetworkDegree;
  /** 已按 {@link NetworkOrdering} 排好序、且**已截断**的邻居。 */
  readonly neighbours: readonly NetworkNeighbour[];
  readonly edges: readonly NetworkEdge[];
}

/**
 * 在总预算内分配「靶点优先、相互作用补足」的名额。
 *
 * ## 为什么必须先分预算再取数
 *
 * `limit` 的语义是**这张图一共画多少个邻居**，不是「每类各画多少个」。
 * 曾把 `take: limit` 分别下发给两条查询，于是 `limit=100` 实际返回
 * 100 个相互作用 + 3 个靶点 = 103 个节点——契约说的上限被静默突破。
 *
 * ## 为什么靶点优先
 *
 * 实测单药靶点是个位数（`DB00176` 是 3），而相互作用中位数 542。
 * 靶点是稀疏且信息密度高的那一类，相互作用则大量同质；有限名额先给靶点，
 * 剩下的全部给相互作用，才是「30 个节点能读到最多信息」的分配。
 *
 * 边界：`limit` 小于靶点数时只给靶点（相互作用 0 个）；靶点全部放得下时，
 * 余额由相互作用补满。
 */
export function splitNeighbourBudget(
  targetCount: number,
  interactionCount: number,
  limit: number,
): { readonly targets: number; readonly interactions: number } {
  const budget = Math.max(0, Math.trunc(limit));
  const targets = Math.min(Math.max(0, targetCount), budget);
  const interactions = Math.min(
    Math.max(0, interactionCount),
    budget - targets,
  );
  return { targets, interactions };
}

/**
 * 判断图是否被截断，以及截掉了多少。
 *
 * ## 为什么用总数减而不是由查询返回
 *
 * 查询返回的是截断后的数组，只有 `degree` 是独立统计的**真值**
 * （`count(*)`，走 Index Only Scan，实测 2.4 ms）。两者相减就是被丢弃的
 * 数量——不需要第二趟查询，也不会出现「截断数与总数各算一套」的矛盾。
 *
 * 靶点边不参与截断：靶点的度数是个位数到几十（实测 `DB00176` 是 3），
 * 不存在画不下的问题。
 */
export function countTruncated(
  degree: NetworkDegree,
  neighbours: readonly NetworkNeighbour[],
): number {
  const shown = neighbours.length;
  const total = degree.interactions + degree.targets;
  return Math.max(0, total - shown);
}

/**
 * 把原始结果折成最终图。
 *
 * 放成函数而不是在用例里内联，是为了让「截断数」这条唯一的算术只有一处
 * 定义——它是页面上「还有 2,219 个未显示」这句话的唯一来源。
 */
export function buildNetworkGraph(input: NetworkInput): NetworkGraph {
  return {
    center: input.center,
    degree: input.degree,
    neighbours: input.neighbours,
    edges: input.edges,
    truncated: countTruncated(input.degree, input.neighbours),
    ordering: 'drugbank_id_asc',
  };
}
