/**
 * Graph reader port (ADR-0009 / ADR-0024 `application/ports`).
 *
 * ## 为什么入参全是业务标识而不是 Cypher / GraphQL
 *
 * 查询由基础设施层的 OGM schema 固定，调用方只能给**参数**（DrugBank id、
 * 基因名）。这既是安全边界——不给客户端一个任意查询执行面——也让应用层
 * 可以在单元测试里用假实现替换，不必连图。
 */

import type { RelationQueryOutcome } from './relation.js';
import type {
  CascadePath,
  DrugAction,
  EnzymeDuel,
  MechanismPath,
  SharedTarget,
  ShortestRoute,
  SubstituteCandidate,
  TargetDrug,
  TransportRoute,
} from './relation.js';

export const MEDICINES_GRAPH_READER = 'MEDICINES_GRAPH_READER';

/**
 * 9 个多跳图查询。
 *
 * 分成三类，因为它们回答的是不同层次的问题：
 *
 * - **机理**（`mechanismPaths` / `cascadePaths` / `enzymeDuel`）：为什么冲突、
 *   通过什么传播；
 * - **集合**（`sharedTargets` / `drugActions` / `targetDrugs`）：这组药在图上
 *   交汇在哪；
 * - **结构**（`shortestRoute` / `transportRoutes` / `substituteCandidates`）：
 *   两个点之间怎么连、药怎么进出细胞、哪条路可以避开。
 */
export interface GraphReader {
  /** 两药经同一代谢酶形成的通路（`INHIBITS`/`INDUCES` × `SUBSTRATE_OF`）。 */
  mechanismPaths(
    drugbankIds: readonly string[],
  ): Promise<RelationQueryOutcome<readonly MechanismPath[]>>;

  /** 这组药共同作用的靶点。 */
  sharedTargets(
    drugbankIds: readonly string[],
  ): Promise<RelationQueryOutcome<readonly SharedTarget[]>>;

  /** 4 跳代谢级联：A 抑制酶1 → C → B。只有图能表达的传播路径。 */
  cascadePaths(
    startDrugbankId: string,
  ): Promise<RelationQueryOutcome<readonly CascadePath[]>>;

  /** 不走指定酶、但共享靶点的其他药物（**结构事实**，非处方建议）。 */
  substituteCandidates(
    drugbankId: string,
    enzymeGene: string,
  ): Promise<RelationQueryOutcome<readonly SubstituteCandidate[]>>;

  /** 单药的作用谱。 */
  drugActions(
    drugbankId: string,
  ): Promise<RelationQueryOutcome<readonly DrugAction[]>>;

  /** 两药在图上的最短传播路径。 */
  shortestRoute(
    fromDrugbankId: string,
    toDrugbankId: string,
  ): Promise<RelationQueryOutcome<readonly ShortestRoute[]>>;

  /** 靶点视角：某靶点上的全部药物。 */
  targetDrugs(
    geneName: string,
  ): Promise<RelationQueryOutcome<readonly TargetDrug[]>>;

  /** 转运体路径（外排/摄取）。 */
  transportRoutes(
    drugbankId: string,
  ): Promise<RelationQueryOutcome<readonly TransportRoute[]>>;

  /** 酶诱导 × 底物：浓度方向相反的间接相互作用。 */
  enzymeDuel(
    drugbankIds: readonly string[],
  ): Promise<RelationQueryOutcome<readonly EnzymeDuel[]>>;

  /** 图是否已配置。未配置时各查询返回 `notConfigured`。 */
  isConfigured(): boolean;
}
