import {
  Controller,
  Get,
  Inject,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { registerResponseSchema } from '../../../../common/api/response-schema.registry.js';
import { Public } from '../../../auth/index.js';
import type { RelationQueryOutcome } from '../../domain/relations/relation.js';
import {
  MEDICINES_GRAPH_READER,
  type GraphReader,
} from '../../domain/relations/relations.js';
import { medicationOverviewResponseSchema } from './dto/medication-overview.js';
import {
  cascadePathsResponseSchema,
  drugActionsResponseSchema,
  enzymeDuelsResponseSchema,
  mechanismPathsResponseSchema,
  multiDrugQuerySchema,
  routeQuerySchema,
  sharedTargetsResponseSchema,
  shortestRoutesResponseSchema,
  singleDrugQuerySchema,
  substituteCandidatesResponseSchema,
  substituteQuerySchema,
  targetDrugsResponseSchema,
  targetQuerySchema,
  transportRoutesResponseSchema,
  type GraphQueryStatus,
  type MultiDrugQueryDto,
  type RouteQueryDto,
  type SingleDrugQueryDto,
  type SubstituteQueryDto,
  type TargetQueryDto,
} from './dto/relations.js';

/**
 * 药品关系图查询端点。
 *
 * ## 为什么是 9 个端点而不是 1 个通用查询
 *
 * 图的价值在**多跳和路径**，而每类问题的图模式差别很大（二跳、4 跳级联、
 * 最短路径、反模式排除）。把它们塞进一个「传参数换查询」的端点，等于把
 * Cypher 的选择权交回客户端——那就退化成开放的图查询面。
 *
 * 每个端点**只收业务参数**，Cypher 固定在 `infrastructure/graph/schema.ts`。
 * 客户端永远无法表达「我想跑这段查询」。
 *
 * ## 为什么全部 `@Public()`
 *
 * 药物知识是只读的公共数据，与手机端的 `/medicines/*` 一致（那个控制器同样
 * `@Public()`）。这里不涉及任何用户数据。**但**：图查询是相对昂贵的操作，
 * 若将来出现滥用，应改为按调用方限流而不是加鉴权——鉴权解决不了「一个合法
 * 用户打爆图库」的问题。
 *
 * ## 失败为什么用 200 + status 表达
 *
 * 「图不可用」不是客户端的请求错误（4xx），也不是服务端 bug（5xx 会触发重试
 * 与告警）——它是**已知的、可降级的状态**。用 `status` 字段表达，客户端据此
 * 显示「暂时无法给出机理分析」，而不是「无风险」。
 */
@ApiTags('Medicines')
@Controller('medicines')
export class MedicinesRelationsController {
  constructor(
    @Inject(MEDICINES_GRAPH_READER)
    private readonly reader: GraphReader,
  ) {}

  @Public()
  @Get('relations/mechanism-paths')
  @ApiOperation({
    operationId: 'listMechanismPaths',
    summary:
      'Metabolic mechanism paths between drugs (INHIBITS/INDUCES x SUBSTRATE_OF)',
  })
  @ApiQuery({
    name: 'drugbankIds',
    description: 'Comma-separated DrugBank ids (2-10)',
  })
  @ApiResponse({
    status: 200,
    description: 'Mechanism paths, or a status explaining why none.',
  })
  @SerializeOptions({ schema: mechanismPathsResponseSchema })
  async mechanismPaths(
    @Query({ schema: multiDrugQuerySchema }) query: MultiDrugQueryDto,
  ) {
    const outcome = await this.reader.mechanismPaths(query.drugbankIds);
    return this.envelope(outcome, (paths) => ({ paths }));
  }

  @Public()
  @Get('relations/shared-targets')
  @ApiOperation({
    operationId: 'listSharedTargets',
    summary: 'Targets shared by a set of drugs',
  })
  @ApiQuery({
    name: 'drugbankIds',
    description: 'Comma-separated DrugBank ids (2-10)',
  })
  @ApiResponse({
    status: 200,
    description: 'Shared targets, or a status explaining why none.',
  })
  @SerializeOptions({ schema: sharedTargetsResponseSchema })
  async sharedTargets(
    @Query({ schema: multiDrugQuerySchema }) query: MultiDrugQueryDto,
  ) {
    const outcome = await this.reader.sharedTargets(query.drugbankIds);
    return this.envelope(outcome, (targets) => ({ targets }));
  }

  @Public()
  @Get('relations/cascade-paths')
  @ApiOperation({
    operationId: 'listCascadePaths',
    summary: 'Four-hop metabolic cascade starting from one drug',
  })
  @ApiQuery({ name: 'drugbankId', description: 'Starting DrugBank id' })
  @ApiResponse({
    status: 200,
    description: 'Cascade chains, or a status explaining why none.',
  })
  @SerializeOptions({ schema: cascadePathsResponseSchema })
  async cascadePaths(
    @Query({ schema: singleDrugQuerySchema }) query: SingleDrugQueryDto,
  ) {
    const outcome = await this.reader.cascadePaths(query.drugbankId);
    return this.envelope(outcome, (cascades) => ({ cascades }));
  }

  @Public()
  @Get('relations/substitutes')
  @ApiOperation({
    operationId: 'listSubstituteCandidates',
    summary:
      'Structural candidates that do not use a given enzyme (not a prescription)',
  })
  @ApiQuery({ name: 'drugbankId', description: 'DrugBank id being replaced' })
  @ApiQuery({ name: 'enzymeGene', description: 'Enzyme to avoid, e.g. CYP2C9' })
  @ApiResponse({
    status: 200,
    description: 'Structural candidates with their shared target.',
  })
  @SerializeOptions({ schema: substituteCandidatesResponseSchema })
  async substitutes(
    @Query({ schema: substituteQuerySchema }) query: SubstituteQueryDto,
  ) {
    const outcome = await this.reader.substituteCandidates(
      query.drugbankId,
      query.enzymeGene,
    );
    return this.envelope(outcome, (candidates) => ({ candidates }));
  }

  @Public()
  @Get('relations/actions')
  @ApiOperation({
    operationId: 'listDrugActions',
    summary: 'What targets one drug acts on',
  })
  @ApiQuery({ name: 'drugbankId', description: 'DrugBank id' })
  @ApiResponse({
    status: 200,
    description: 'Target action spectrum of the drug.',
  })
  @SerializeOptions({ schema: drugActionsResponseSchema })
  async actions(
    @Query({ schema: singleDrugQuerySchema }) query: SingleDrugQueryDto,
  ) {
    const outcome = await this.reader.drugActions(query.drugbankId);
    return this.envelope(outcome, (actions) => ({ actions }));
  }

  @Public()
  @Get('relations/shortest-route')
  @ApiOperation({
    operationId: 'listShortestRoutes',
    summary: 'Shortest propagation route between two drugs',
  })
  @ApiQuery({ name: 'fromDrugbankId', description: 'Source DrugBank id' })
  @ApiQuery({ name: 'toDrugbankId', description: 'Target DrugBank id' })
  @ApiResponse({
    status: 200,
    description: 'Shortest routes, with nodes and edge types.',
  })
  @SerializeOptions({ schema: shortestRoutesResponseSchema })
  async shortestRoute(
    @Query({ schema: routeQuerySchema }) query: RouteQueryDto,
  ) {
    const outcome = await this.reader.shortestRoute(
      query.fromDrugbankId,
      query.toDrugbankId,
    );
    return this.envelope(outcome, (routes) => ({ routes }));
  }

  @Public()
  @Get('relations/target-drugs')
  @ApiOperation({
    operationId: 'listTargetDrugs',
    summary: 'All drugs acting on one target gene',
  })
  @ApiQuery({
    name: 'geneName',
    description: 'Target gene symbol, e.g. CYP2C9',
  })
  @ApiResponse({
    status: 200,
    description: 'Drugs acting on the target, with relation type.',
  })
  @SerializeOptions({ schema: targetDrugsResponseSchema })
  async targetDrugs(
    @Query({ schema: targetQuerySchema }) query: TargetQueryDto,
  ) {
    const outcome = await this.reader.targetDrugs(query.geneName);
    return this.envelope(outcome, (drugs) => ({ drugs }));
  }

  @Public()
  @Get('relations/transport-routes')
  @ApiOperation({
    operationId: 'listTransportRoutes',
    summary: 'Transporter routes (efflux/uptake) for one drug',
  })
  @ApiQuery({ name: 'drugbankId', description: 'DrugBank id' })
  @ApiResponse({
    status: 200,
    description: 'Transporter routes, with edge direction.',
  })
  @SerializeOptions({ schema: transportRoutesResponseSchema })
  async transportRoutes(
    @Query({ schema: singleDrugQuerySchema }) query: SingleDrugQueryDto,
  ) {
    const outcome = await this.reader.transportRoutes(query.drugbankId);
    return this.envelope(outcome, (routes) => ({ routes }));
  }

  @Public()
  @Get('relations/enzyme-duel')
  @ApiOperation({
    operationId: 'listEnzymeDuels',
    summary: 'Induction vs substrate pairs: opposite effect on exposure',
  })
  @ApiQuery({
    name: 'drugbankIds',
    description: 'Comma-separated DrugBank ids (2-10)',
  })
  @ApiResponse({
    status: 200,
    description: 'Inducer/substrate pairs sharing one enzyme.',
  })
  @SerializeOptions({ schema: enzymeDuelsResponseSchema })
  async enzymeDuel(
    @Query({ schema: multiDrugQuerySchema }) query: MultiDrugQueryDto,
  ) {
    const outcome = await this.reader.enzymeDuel(query.drugbankIds);
    return this.envelope(outcome, (duels) => ({ duels }));
  }

  /**
   * 把内部判别式结果转成响应信封。
   *
   * 成功时 `status: 'ok'` 并附数据（可以是空数组：**空 ≠ 查不了**）；
   * 失败时只给 `status`，不伪造空数组。
   */
  private envelope<T>(
    outcome: RelationQueryOutcome<T>,
    wrap: (value: T) => Record<string, unknown>,
  ): { status: GraphQueryStatus } & Record<string, unknown> {
    if (!outcome.ok) {
      return { status: outcome.reason };
    }
    return { status: 'ok', ...wrap(outcome.value) };
  }
}

/**
 * 响应 schema 登记。
 *
 * Swagger 不内省 `@SerializeOptions`，所以每个端点必须在注册表里再声明一次
 * 组件名，`scripts/contract/export-openapi.ts` 才会把 `200` 指向真实 body。
 * 不登记的表现是契约里只有 description、没有 schema——生成客户端于是把返回
 * 值落成 `void`，前端只能手写 Dio 取原始 JSON。
 */
registerResponseSchema({
  path: '/api/v1/medicines/relations/mechanism-paths',
  method: 'get',
  componentName: 'MedicineMechanismPathsResponse',
  schema: mechanismPathsResponseSchema,
  description: 'Mechanism paths, or a status explaining why none.',
});

registerResponseSchema({
  path: '/api/v1/medicines/relations/shared-targets',
  method: 'get',
  componentName: 'MedicineSharedTargetsResponse',
  schema: sharedTargetsResponseSchema,
  description: 'Shared targets, or a status explaining why none.',
});

registerResponseSchema({
  path: '/api/v1/medicines/relations/cascade-paths',
  method: 'get',
  componentName: 'MedicineCascadePathsResponse',
  schema: cascadePathsResponseSchema,
  description: 'Cascade chains, or a status explaining why none.',
});

registerResponseSchema({
  path: '/api/v1/medicines/relations/substitutes',
  method: 'get',
  componentName: 'MedicineSubstituteCandidatesResponse',
  schema: substituteCandidatesResponseSchema,
  description: 'Structural candidates with their shared target.',
});

registerResponseSchema({
  path: '/api/v1/medicines/relations/actions',
  method: 'get',
  componentName: 'MedicineDrugActionsResponse',
  schema: drugActionsResponseSchema,
  description: 'Target action spectrum of the drug.',
});

registerResponseSchema({
  path: '/api/v1/medicines/relations/shortest-route',
  method: 'get',
  componentName: 'MedicineShortestRoutesResponse',
  schema: shortestRoutesResponseSchema,
  description: 'Shortest routes, with nodes and edge types.',
});

registerResponseSchema({
  path: '/api/v1/medicines/relations/target-drugs',
  method: 'get',
  componentName: 'MedicineTargetDrugsResponse',
  schema: targetDrugsResponseSchema,
  description: 'Drugs acting on the target, with relation type.',
});

registerResponseSchema({
  path: '/api/v1/medicines/relations/transport-routes',
  method: 'get',
  componentName: 'MedicineTransportRoutesResponse',
  schema: transportRoutesResponseSchema,
  description: 'Transporter routes, with edge direction.',
});

registerResponseSchema({
  path: '/api/v1/medicines/relations/enzyme-duel',
  method: 'get',
  componentName: 'MedicineEnzymeDuelsResponse',
  schema: enzymeDuelsResponseSchema,
  description: 'Inducer/substrate pairs sharing one enzyme.',
});

registerResponseSchema({
  path: '/api/v1/medicines/medication-overview',
  method: 'get',
  componentName: 'MedicationOverviewResponse',
  schema: medicationOverviewResponseSchema,
  description:
    'Duplicate ingredients and source grouping for the current medicines.',
});
