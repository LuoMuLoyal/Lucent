import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../prisma/index.js';
import type {
  MedicinesNetworkReader,
  NetworkFacts,
  NetworkQuery,
} from '../../application/ports/network.js';
import {
  splitNeighbourBudget,
  type NetworkEdge,
  type NetworkNeighbour,
} from '../../domain/relations/network.js';

/**
 * 邻域图的持久层实现（Prisma / Postgres）。
 *
 * ## 查询计划是这里唯一的难点，三条规则都来自实测
 *
 * ### 1. 度数必须 `count(*)`，不能拿数组长度
 *
 * 详情接口对相互作用是 `take: 200`，而 `DB00176` 真实度数是 **2,249**。
 * 把 200 当度数展示就是假精确。`count(*)` 走
 * `(drugbank_id, interacts_with_id)` 唯一索引的 Index Only Scan，实测 **2.4 ms**。
 *
 * ### 2. 邻居按索引序截断，**不要**按「伙伴度数」排序
 *
 * 曾按「伙伴自己的相互作用数降序」取 Top-N（直觉上能揭示网络结构）。实测
 * `DB00176` 的 2,249 个邻居每个都要一次度数统计，单条查询 **757 ms**——
 * 这是 N+1 的 SQL 形态。改成 `ORDER BY interacts_with_id LIMIT n` 后走
 * Index Scan 直接流式取前 n，**0.086 ms**，快 8,800 倍。
 *
 * 代价是选择结果依赖 id 字典序而非重要性。这个取舍由领域层用 `ordering`
 * 字段如实声明（见 `domain/relations/network.ts` 文件头）。
 *
 * ### 3. `inCatalogue` 要单独查，不能靠 JOIN 判断
 *
 * `drugbank_drug_interactions` 刻意**不建** `interacts_with_id` 外键：伙伴可能
 * 已被上游下线。所以「是否在库内」是一次 `IN (...)` 的存在性查询，
 * 而不是 JOIN 的命中与否——后者会把库外伙伴静默丢掉，于是图上的边数与
 * `degree` 对不上。
 */
@Injectable()
export class PrismaMedicineNetworkReader implements MedicinesNetworkReader {
  constructor(private readonly prisma: PrismaService) {}

  async read(query: NetworkQuery): Promise<NetworkFacts> {
    const center = await this.prisma.drugbankDrug.findUnique({
      where: { drugbankId: query.drugbankId },
      select: { drugbankId: true, name: true },
    });

    if (!center) {
      return {
        center: null,
        degree: { interactions: 0, targets: 0 },
        neighbours: [],
        edges: [],
      };
    }

    const [interactions, interactionCount, targetRows, targetCount] =
      await Promise.all([
        // 索引序截断：走 (drugbank_id, interacts_with_id) 索引的 Index Scan。
        this.prisma.drugbankDrugInteraction.findMany({
          where: { drugbankId: query.drugbankId },
          orderBy: { interactsWithId: 'asc' },
          take: query.limit,
          select: {
            interactsWithId: true,
            interactsWithName: true,
          },
        }),
        this.prisma.drugbankDrugInteraction.count({
          where: { drugbankId: query.drugbankId },
        }),
        this.prisma.drugbankDrugTarget.findMany({
          where: { drugbankId: query.drugbankId },
          orderBy: [{ relationKind: 'asc' }, { targetId: 'asc' }],
          take: query.limit,
          select: {
            relationKind: true,
            actions: true,
            target: {
              select: { id: true, name: true },
            },
          },
        }),
        this.prisma.drugbankDrugTarget.count({
          where: { drugbankId: query.drugbankId },
        }),
      ]);

    // 名额分配：靶点优先，相互作用补足余额（见 `splitNeighbourBudget`）。
    // 两条查询都先按 `limit` 取上界，再按预算切片——比「先 count 再 fetch」
    // 少一次往返，而 `limit` ≤ 100 时多取的那部分可以忽略。
    const budget = splitNeighbourBudget(
      targetCount,
      interactionCount,
      query.limit,
    );

    const trimmedInteractions = interactions.slice(0, budget.interactions);
    const trimmedTargets = targetRows.slice(0, budget.targets);

    // 库内判定：一次 IN 查询，只针对本次要展示的伙伴。
    const partnerIds = trimmedInteractions.map((row) => row.interactsWithId);
    const inCatalogueIds =
      partnerIds.length === 0
        ? new Set<string>()
        : new Set(
            (
              await this.prisma.drugbankDrug.findMany({
                where: { drugbankId: { in: partnerIds } },
                select: { drugbankId: true },
              })
            ).map((row) => row.drugbankId),
          );

    const neighbours: NetworkNeighbour[] = [
      ...trimmedInteractions.map(
        (row): NetworkNeighbour => ({
          id: row.interactsWithId,
          // 源里没写伙伴名时退回 id：显示一个空的节点比显示 id 更让人困惑。
          name: row.interactsWithName?.trim() || row.interactsWithId,
          nodeKind: 'drug',
          inCatalogue: inCatalogueIds.has(row.interactsWithId),
        }),
      ),
      ...trimmedTargets.map(
        (row): NetworkNeighbour => ({
          id: row.target.id,
          name: row.target.name,
          nodeKind: 'protein',
          inCatalogue: true,
        }),
      ),
    ];

    const edges: NetworkEdge[] = [
      ...trimmedInteractions.map(
        (row): NetworkEdge => ({
          kind: 'interaction',
          neighbourId: row.interactsWithId,
          relationKind: null,
          actions: [],
        }),
      ),
      ...trimmedTargets.map(
        (row): NetworkEdge => ({
          kind: 'target',
          neighbourId: row.target.id,
          relationKind: row.relationKind,
          actions: toStringList(row.actions),
        }),
      ),
    ];

    return {
      center: { id: center.drugbankId, name: center.name },
      degree: { interactions: interactionCount, targets: targetCount },
      neighbours,
      edges,
    };
  }
}

/**
 * `actions` 是 `Json?` 列，入库时是字符串数组。
 *
 * 形状不可信时返回空数组而不是抛错：一个格式异常的 action 单元格不该让
 * 整张图打不开——图的主体是节点与边，作用方式是可选装饰。
 */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
