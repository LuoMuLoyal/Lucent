import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { execute, parse, type GraphQLSchema } from 'graphql';
import neo4j, { type Driver } from 'neo4j-driver';

import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import type { RelationQueryFailureReason } from '../../domain/relations/relation.js';
import { MEDICINE_GRAPH_TYPE_DEFS } from './schema.js';

/** 单条查询的默认事务超时（毫秒）。多跳查询比单表慢，比 driver 默认值宽。 */
const DEFAULT_TX_TIMEOUT_MS = 8_000;

/** 已声明可用的查询名。与实际 schema 中的字段一一对应，用于入参校验与测试。 */
export const MEDICINE_GRAPH_QUERIES = [
  'mechanismPaths',
  'sharedTargets',
  'cascadePaths',
  'substituteCandidates',
  'drugActions',
  'shortestRoute',
  'targetDrugs',
  'transportRoutes',
  'enzymeDuel',
] as const;

export type MedicineGraphQueryName = (typeof MEDICINE_GRAPH_QUERIES)[number];

/** 一次查询失败的判别式结果。 */
export interface GraphQueryFailure {
  readonly ok: false;
  readonly reason: RelationQueryFailureReason;
}

export interface GraphQuerySuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type GraphQueryOutcome<T> = GraphQuerySuccess<T> | GraphQueryFailure;

/**
 * 药品关系图的执行器 —— **所有图查询的唯一出口，且统一经 OGM**。
 *
 * ## 为什么连手写 Cypher 也走 `@neo4j/graphql`
 *
 * 图模型（标签、属性名、关系类型）与查询形态在 `schema.ts` 里声明一次，由 OGM
 * 负责：解析 SDL、校验查询、把结果投影成我们声明的形状。手写 Cypher 挂在
 * `@cypher` 指令上，**仍然由同一个 OGM schema 执行**——不是绕过它直连 driver。
 * 这样「图长什么样」只有一份事实源，而不是散落在每个查询的字符串里。
 *
 * ## 为什么外层不是 GraphQL 端点
 *
 * 这个 schema **不出现在路由上**。它只在服务端内部被调用：REST 端点收
 * `drugbankIds` 这类参数，拼成受控的 GraphQL 文档后交给这里执行。客户端永远
 * 拿不到「自由写 GraphQL / Cypher」的能力——那是把图查询面暴露到公网。
 *
 * ## 失败为什么是判别式而不是异常
 *
 * 「图连不上」「查询超时」「没配置」与「图上确实没有」是**不同的事实**。
 * 抛异常会诱使调用方用一个 catch 把它们合成空结果——在用药场景里，那等于
 * 把「我们不知道」显示成「安全」。调用方必须显式处理 `ok: false`。
 */
@Injectable()
export class MedicineGraphExecutor implements OnModuleDestroy {
  private readonly logger = new Logger(MedicineGraphExecutor.name);
  private readonly uri: string;
  private readonly user: string;
  private readonly password: string;
  private readonly txTimeoutMs: number;

  private driver: Driver | null = null;
  /** schema 构建是异步的，且只需一次；存 Promise 以避免并发首查重复构建。 */
  private schemaPromise: Promise<GraphQLSchema> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.uri = this.configService.get<string>(EnvKey.NEO4J_URI)?.trim() ?? '';
    this.user =
      this.configService.get<string>(EnvKey.NEO4J_USER)?.trim() || 'neo4j';
    this.password =
      this.configService.get<string>(EnvKey.NEO4J_PASSWORD)?.trim() ?? '';
    this.txTimeoutMs = this.readTimeout();
  }

  /** URI 与口令都非空才算启用。口令为空是「没配凭据」，不是「无口令」。 */
  isConfigured(): boolean {
    return this.uri.length > 0 && this.password.length > 0;
  }

  /**
   * 执行一个已声明的图查询。
   *
   * @param queryName `MEDICINE_GRAPH_QUERIES` 里的名字。
   * @param args 查询参数。**只接受参数，不接受 Cypher**——Cypher 固定在 schema 里。
   * @param selection 要取的字段（GraphQL selection set），例如 `enzymeGene relation`。
   * @throws 不会抛：失败一律返回 `{ ok: false }`。
   */
  async run<T>(
    queryName: MedicineGraphQueryName,
    args: Record<string, unknown>,
    selection: string,
  ): Promise<GraphQueryOutcome<T>> {
    if (!this.isConfigured()) {
      return { ok: false, reason: 'notConfigured' };
    }

    try {
      const schema = await this.getSchema();
      const document = parse(this.buildQuery(queryName, args, selection));
      const result = await execute({
        schema,
        document,
        // 变量值必须显式传入：document 里只有 `$name: Type!` 的**声明**，
        // 值走 variableValues。漏传时执行器报 "Variable not provided"——
        // 这是在真实图上跑通之前抓到的错误（schema 单测发现不了）。
        variableValues: args,
        contextValue: { executionContext: this.getDriver() },
      });

      // GraphQL 把「部分失败」也放在 errors 里；有错即视为本次查询不可用，
      // 不把半截结果当作完整答案。
      if (result.errors !== undefined && result.errors.length > 0) {
        const message = result.errors.map((error) => error.message).join('; ');
        this.logger.warn(`Graph query ${queryName} failed: ${message}`);
        return { ok: false, reason: this.classifyFailure(message) };
      }

      return { ok: true, value: this.dataOf(result.data) as T };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Graph query ${queryName} threw: ${message}`);
      return { ok: false, reason: this.classifyFailure(message) };
    }
  }

  async onModuleDestroy(): Promise<void> {
    const driver = this.driver;
    this.driver = null;
    await driver?.close();
  }

  /**
   * 拼一条**结构固定**的 GraphQL 查询。
   *
   * `queryName` 来自受控联合类型、`args` 走 GraphQL 变量（不经字符串拼接），
   * `selection` 由各调用点在代码里写死。三者都不可由外部请求直接控制，
   * 因此不存在注入面。
   */
  private buildQuery(
    queryName: MedicineGraphQueryName,
    args: Record<string, unknown>,
    selection: string,
  ): string {
    const declared = Object.keys(args);
    const argDefs = declared
      .map((key) => `$${key}: ${this.inferArgType(args[key])}`)
      .join(', ');
    const argUses = declared.map((key) => `${key}: $${key}`).join(', ');
    return `query(${argDefs}) { ${queryName}(${argUses}) { ${selection} } }`;
  }

  /** 参数类型由值推导——值全部来自服务端，类型只需覆盖字符串与字符串数组。 */
  private inferArgType(value: unknown): string {
    return Array.isArray(value) ? '[String!]!' : 'String!';
  }

  private async getSchema(): Promise<GraphQLSchema> {
    this.schemaPromise ??= this.buildSchema();
    return this.schemaPromise;
  }

  /**
   * 构建 OGM schema。
   *
   * `driver` 在这里传入，后续 `execute` 通过 `contextValue.executionContext`
   * 复用同一个驱动；`neo4jGraphQL` 的 schema 需要知道库名才能生成正确的
   * 端标签查询，因此把 `database` 一并交给它。
   */
  private async buildSchema(): Promise<GraphQLSchema> {
    const ogm = new Neo4jGraphQL({
      typeDefs: MEDICINE_GRAPH_TYPE_DEFS,
      driver: this.getDriver(),
      features: {
        excludeDeprecatedFields: {
          attributeFilters: true,
          relationshipFilters: true,
        },
      },
    });
    return ogm.getSchema();
  }

  /**
   * 惰性创建驱动。
   *
   * 不在构造时连库：本地与 CI 大多没有图库，启动期不应因为图不可达而失败或变慢。
   */
  private getDriver(): Driver {
    this.driver ??= neo4j.driver(
      this.uri,
      neo4j.auth.basic(this.user, this.password),
      {
        // driver 层再兜一层超时：transaction 超时只在事务真正开始后生效，
        // 连接握手卡住时它管不到。
        connectionTimeout: this.txTimeoutMs,
        maxConnectionPoolSize: 8,
      },
    );
    return this.driver;
  }

  private dataOf(data: Record<string, unknown> | null | undefined): unknown {
    const first =
      data === null || data === undefined ? undefined : Object.values(data)[0];
    return Array.isArray(first) ? first : [];
  }

  private classifyFailure(message: string): RelationQueryFailureReason {
    const normalized = message.toLowerCase();
    if (normalized.includes('timeout') || normalized.includes('timed out')) {
      return 'timeout';
    }
    return 'unavailable';
  }

  private readTimeout(): number {
    const raw = this.configService.get<string>(EnvKey.NEO4J_TX_TIMEOUT_MS);
    const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_TX_TIMEOUT_MS;
  }
}
