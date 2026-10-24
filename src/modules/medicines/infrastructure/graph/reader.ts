import { Injectable } from '@nestjs/common';

import type {
  CascadePath,
  DrugAction,
  EnzymeDuel,
  MechanismPath,
  RelationQueryOutcome,
  SharedTarget,
  ShortestRoute,
  SubstituteCandidate,
  TargetDrug,
  TransportRoute,
} from '../../domain/relations/relation.js';
import type { GraphReader } from '../../domain/relations/relations.js';
import { MedicineGraphExecutor } from './executor.js';

/** 多药查询的入参上限。超过就截断，而不是让笛卡尔积把数据库拖住。 */
const MAX_DRUG_IDS = 10;

/**
 * `GraphReader` 的 OGM 实现。
 *
 * ## 这一层只做「领域参数 → 受控 GraphQL 查询」
 *
 * 每个方法把业务参数交给 {@link MedicineGraphExecutor}，并在代码里写死要取的
 * 字段（selection）。**没有任何一处接受外部传入的 Cypher 或 GraphQL**——
 * 那是这个模块最重要的安全边界：客户端只能决定「查什么药」，
 * 不能决定「查什么图」。
 *
 * ## 截断而不是报错
 *
 * 超过 {@link MAX_DRUG_IDS} 个药时取前 N 个：对「多药全景」这类场景，少几个药
 * 仍然给出有用结果；而拒绝请求会让界面无从降级。真正的上限保护在 Cypher 的
 * `LIMIT`（schema 里固定），这里的截断只是少打几次组合。
 */
@Injectable()
export class Neo4jGraphReader implements GraphReader {
  constructor(private readonly executor: MedicineGraphExecutor) {}

  isConfigured(): boolean {
    return this.executor.isConfigured();
  }

  async mechanismPaths(
    drugbankIds: readonly string[],
  ): Promise<RelationQueryOutcome<readonly MechanismPath[]>> {
    const ids = this.limitIds(drugbankIds);
    // 少于两个药时不存在「两药之间」，这是**确定的空答案**而不是失败：
    // 返回 ok 让调用方能区分「没有路径」与「查不了」。
    if (ids.length < 2) return { ok: true, value: [] };

    return this.executor.run<readonly MechanismPath[]>(
      'mechanismPaths',
      { drugbankIds: ids },
      'enzymeGene enzymeName otherDrugId otherDrugName relation',
    );
  }

  async sharedTargets(
    drugbankIds: readonly string[],
  ): Promise<RelationQueryOutcome<readonly SharedTarget[]>> {
    const ids = this.limitIds(drugbankIds);
    if (ids.length < 2) return { ok: true, value: [] };

    return this.executor.run<readonly SharedTarget[]>(
      'sharedTargets',
      { drugbankIds: ids },
      'targetGene targetName drugCount drugIds drugNames',
    );
  }

  async cascadePaths(
    startDrugbankId: string,
  ): Promise<RelationQueryOutcome<readonly CascadePath[]>> {
    return this.executor.run<readonly CascadePath[]>(
      'cascadePaths',
      { startDrugbankId },
      'startDrug enzymeOne middleDrug enzymeTwo endDrug',
    );
  }

  async substituteCandidates(
    drugbankId: string,
    enzymeGene: string,
  ): Promise<RelationQueryOutcome<readonly SubstituteCandidate[]>> {
    return this.executor.run<readonly SubstituteCandidate[]>(
      'substituteCandidates',
      { drugbankId, enzymeGene },
      'drugbankId name sharedTarget',
    );
  }

  async drugActions(
    drugbankId: string,
  ): Promise<RelationQueryOutcome<readonly DrugAction[]>> {
    return this.executor.run<readonly DrugAction[]>(
      'drugActions',
      { drugbankId },
      'targetGene targetName relation actions',
    );
  }

  async shortestRoute(
    fromDrugbankId: string,
    toDrugbankId: string,
  ): Promise<RelationQueryOutcome<readonly ShortestRoute[]>> {
    // 同一个药之间谈「路径」没有意义，直接给确定空答案。
    if (fromDrugbankId === toDrugbankId) return { ok: true, value: [] };

    return this.executor.run<readonly ShortestRoute[]>(
      'shortestRoute',
      { fromDrugbankId, toDrugbankId },
      'stepCount pathNodes pathRelations',
    );
  }

  async targetDrugs(
    geneName: string,
  ): Promise<RelationQueryOutcome<readonly TargetDrug[]>> {
    return this.executor.run<readonly TargetDrug[]>(
      'targetDrugs',
      { geneName },
      'drugbankId name relation',
    );
  }

  async transportRoutes(
    drugbankId: string,
  ): Promise<RelationQueryOutcome<readonly TransportRoute[]>> {
    return this.executor.run<readonly TransportRoute[]>(
      'transportRoutes',
      { drugbankId },
      'transporterGene transporterName inverted',
    );
  }

  async enzymeDuel(
    drugbankIds: readonly string[],
  ): Promise<RelationQueryOutcome<readonly EnzymeDuel[]>> {
    const ids = this.limitIds(drugbankIds);
    if (ids.length < 2) return { ok: true, value: [] };

    return this.executor.run<readonly EnzymeDuel[]>(
      'enzymeDuel',
      { drugbankIds: ids },
      'enzymeGene inducerDrug inhibitedSubstrate',
    );
  }

  /** 去重 + 上限。重复 ID 会让 Cypher 的 `IN` 变小但组合数不变，去重更省。 */
  private limitIds(drugbankIds: readonly string[]): string[] {
    return [
      ...new Set(
        drugbankIds.map((id) => id.trim()).filter((id) => id.length > 0),
      ),
    ].slice(0, MAX_DRUG_IDS);
  }
}
