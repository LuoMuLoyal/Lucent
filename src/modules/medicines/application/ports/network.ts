/**
 * 单药邻域图的读路径契约（ADR-0024 `application/ports`）。
 *
 * ## 为什么单独建端口而不是塞进 `MedicinesSourceReader`
 *
 * `MedicinesSourceReader` 是「按 id 取一个实体」的通用形状（search / detail /
 * sequences），两种知识源都要实现它。邻域图是**只读的统计型查询**：
 *
 * 1. 它需要一个 `count(*)` 真值，而那是详情投影给不了的（详情对相互作用
 *    `take: 200`，长度不是度数）；
 * 2. 它只对 DrugBank 有意义——中文说明书没有靶点与相互作用图；
 * 3. 它的上限、排序与截断语义已经由 `domain/relations/network.ts` 决定，
 *    端口只负责「按给定规则取数」。
 *
 * 硬塞进 `MedicinesSourceReader` 会逼中文源实现一个永远返回空的图方法，
 * 那是给接口加噪音。
 */

import type {
  NetworkDepth,
  NetworkEdge,
  NetworkNeighbour,
  NetworkDegree,
} from '../../domain/relations/network.js';

export const MEDICINES_NETWORK_READER = 'MEDICINES_NETWORK_READER';

/** 取一次邻域所需的入参。 */
export interface NetworkQuery {
  readonly drugbankId: string;
  readonly depth: NetworkDepth;
  /** 邻居上限，已由调用方按 {@link MAX_NEIGHBOUR_LIMIT} 钳制。 */
  readonly limit: number;
}

/** 持久层取回的原始事实（尚未装配成图）。 */
export interface NetworkFacts {
  /** 中心药；`null` 表示该 id 不在库内。 */
  readonly center: { readonly id: string; readonly name: string } | null;
  /** 真实度数，来自 `count(*)`。 */
  readonly degree: NetworkDegree;
  /** 已按 `drugbank_id_asc` 排序且已截断的邻居。 */
  readonly neighbours: readonly NetworkNeighbour[];
  /** 与 {@link neighbours} 一一对应的边。 */
  readonly edges: readonly NetworkEdge[];
}

/**
 * 邻域图读取端口。
 *
 * 实现必须保证：
 *
 * - `degree` 来自 `count(*)`，**不是** `neighbours.length`；
 * - `neighbours` 的截断发生在 SQL（`LIMIT`），排序必须是索引序
 *   （`interacts_with_id` 升序），不得为了"重要性"引入全表排序；
 * - 中心药不存在时返回 `center: null` 而不是抛错——调用方据此给 404。
 */
export interface MedicinesNetworkReader {
  read(query: NetworkQuery): Promise<NetworkFacts>;
}
