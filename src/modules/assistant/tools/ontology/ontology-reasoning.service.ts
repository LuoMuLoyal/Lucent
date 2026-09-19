import { Injectable, Logger } from '@nestjs/common';
import type {
  AssistantReadConfidence,
  AssistantReadCoverage,
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/assistant.types.js';
import { buildReadEnvelope } from '../presenters.js';
import { OntologyCypherGeneratorService } from './cypher-generator.service.js';
import type { OntologyCypherOutput } from './cypher.schema.js';
import { SemanticaClientService } from './semantica-client.service.js';
import type { SemanticaQueryOutcome } from './semantica.types.js';
import {
  isRetryableSemanticaFailure,
  SEMANTICA_DEFAULT_LIMIT,
  SEMANTICA_MAX_GENERATION_ATTEMPTS,
  SEMANTICA_MAX_LIMIT,
  SEMANTICA_REASONING_BUDGET_MS,
  SEMANTICA_SOURCE_TIER,
} from './semantica.types.js';

/** 该工具在参数边界拒绝非法入参的统一前缀。 */
const INVALID_ARGUMENT_PREFIX = 'Invalid reason_over_ontology arguments';

/**
 * 客户端侧的纠正信号：查询跑通了、返回了行，但没有任何 `prov`。
 *
 * 与 `SEMANTICA_QUERY_ERROR_KINDS` 分开：那些是 sidecar 的拒绝类别（它拒绝了
 * 语句），而这是**我们**对一次成功查询的验收结论（语句执行了，但缺了可追溯性）。
 * 混进同一组常量会让"sidecar 会返回哪些 kind"这个契约失真。
 */
const MISSING_PROVENANCE_ERROR_KIND = 'missing_provenance';

/**
 * 进 envelope 的引用条数上限。
 *
 * 引用会随 envelope 一起进模型上下文，所以它和行集一样有预算。上限按**行集能带
 * 出的 id 数**取：行数上限 25，一行最多两条关系各带一个 `prov`，60 足够覆盖，
 * 于是"模型在行里看得见的 id"与"客户端拿到手的引用"不会错位——模型照着行里的
 * id 作答、而客户端只拿到其中一部分，正是这条链路最不该出现的状态。
 */
const ONTOLOGY_MAX_CITATIONS = 60;

/**
 * 结果集序列化预算（字符）。
 *
 * 行数上限不等于体积上限：一条相互作用描述可以很长，而 envelope 会整体进模型
 * 上下文。超预算就截断并标 `truncated`，让模型知道"还有但没给全"，而不是让一次
 * 工具调用把上下文吃掉。
 */
const MAX_RESULT_CHARS = 16000;

const SOURCE_TIER_NOTE =
  'DrugBank structured facts, ingested deterministically (no LLM extraction).';

const CITATION_NOTE =
  'Each citation id names the source row an assertion came from; it resolves in the sidecar provenance store, where the entry is hash-chained. A missing id means the graph edge exists but its audit entry does not, which is a reason to distrust that row rather than to cite it.';

/**
 * 可核验性的判定：有行且**有引用**才叫 `citable`。
 *
 * 这是一个诚实性判断，不是措辞：图上的边有 `prov`，但如果 Cypher 没把它取出来
 * （或审计库里没有该 id），那么这些行就没有可回溯的来源，说成 `citable` 等于
 * 给了一句无法核实的话。零行时无可断言，`citable` 成立。
 */
function resolveVerifiability(rowCount: number, citationCount: number): string {
  if (rowCount === 0) {
    return 'citable';
  }
  return citationCount > 0 ? 'citable' : 'uncited';
}

/**
 * 英文侧 OAG 工具：`reason_over_ontology`（计划 §3.6）。
 *
 * 分工（§3.5 ②）：**Lucent 生成 Cypher，sidecar 校验 + 执行**。生成放在这里
 * 的理由是复用 `LlmRuntimeService` 的角色化配置（一套凭据 / 成本 / 限流），
 * 而 sidecar 因此不需要 LLM 凭据；校验与执行放在 sidecar 的理由是紧挨本体
 * schema 与 AGE 限制（只有一处守卫，不会漂移）。
 *
 * 重试回路是**生产必需**（§8.1 风险 2）：把 sidecar 的结构化报错回喂模型重生成，
 * 最多 {@link SEMANTICA_MAX_GENERATION_ATTEMPTS} 次。基础设施类失败不重试——
 * 重试多少次都一样，只会把工具耗时翻几倍。
 *
 * 返回的 envelope 带来源等级（§3.6）：`sourceTier` + `sourceNote` + 实际执行的
 * Cypher（可复核的推导路径），而不是一句"模型说的"。
 */
@Injectable()
export class AssistantToolOntologyReasoningService {
  private readonly logger = new Logger(
    AssistantToolOntologyReasoningService.name,
  );

  constructor(
    private readonly semantica: SemanticaClientService,
    private readonly cypherGenerator: OntologyCypherGeneratorService,
  ) {}

  async reasonOverOntology(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const parsed = parseArguments(context.toolArgs);

    if (!parsed.ok) {
      return this.buildEnvelope({
        question: parsed.question,
        limit: parsed.limit,
        result: buildEmptyResult(),
        coverage: { status: 'empty', reason: parsed.reason },
        confidence: { level: 'low', reason: parsed.reason },
        verifiability: 'unavailable',
        tables: [],
      });
    }

    const { question, limit } = parsed;

    if (!this.semantica.isEnabled()) {
      return this.buildUnavailableEnvelope({
        question,
        limit,
        reason:
          'Ontology reasoning is not configured on this deployment; the English-side knowledge graph cannot be queried.',
        tables: [],
      });
    }

    if (!this.cypherGenerator.hasLanguageModel()) {
      return this.buildUnavailableEnvelope({
        question,
        limit,
        reason:
          'Ontology reasoning is unavailable: no language model is configured for query generation.',
        tables: [],
      });
    }

    // schema 是生成的前置输入：prompt 里只允许出现图上真实存在的名字，
    // 因此每次调用都读一遍（sidecar 侧是一次 get_stats 往返，不是全图扫描）。
    const schemaOutcome = await this.semantica.schema();
    if (!schemaOutcome.ok) {
      return this.buildUnavailableEnvelope({
        question,
        limit,
        reason: `Ontology reasoning is unavailable: ${schemaOutcome.failure.reason}`,
        tables: [],
      });
    }

    const graphSchema = schemaOutcome.value;
    const tables = [`${graphSchema.graph} (Apache AGE)`];

    let previousCypher: string | null = null;
    let previousErrorKind: string | null = null;
    let previousError: string | null = null;
    // 只强制要求一次带引用的重写：属性类问题（问某个字段）本来就没有关系可引，
    // 再逼一次只会把时间花在同一个形状上。
    let provenanceRetried = false;
    const startedAt = Date.now();

    for (
      let attempt = 1;
      attempt <= SEMANTICA_MAX_GENERATION_ATTEMPTS;
      attempt += 1
    ) {
      // 软预算：重试是加分项，不是无限循环。预算用尽时停下并如实说明，
      // 而不是让工具层的硬超时把整次调用掐成一个没有上下文的 timeout 信封。
      if (
        attempt > 1 &&
        Date.now() - startedAt >= SEMANTICA_REASONING_BUDGET_MS
      ) {
        return this.buildGenerationFailureEnvelope({
          question,
          limit,
          attempts: attempt - 1,
          lastCypher: previousCypher,
          lastError: previousError,
          graph: graphSchema.graph,
          tables,
          reason: `Ontology reasoning exhausted its ${String(SEMANTICA_REASONING_BUDGET_MS)}ms budget after ${String(attempt - 1)} attempts: ${previousError ?? 'unknown error'}`,
        });
      }

      let generated: OntologyCypherOutput;
      try {
        generated = await this.cypherGenerator.generate(
          {
            question,
            schema: graphSchema,
            previousCypher,
            previousErrorKind,
            previousError,
            attempt,
          },
          {},
        );
      } catch (error) {
        this.logger.warn(
          `Ontology query generation failed on attempt ${String(attempt)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
        return this.buildUnavailableEnvelope({
          question,
          limit,
          reason: `Ontology reasoning is unavailable: query generation failed (${
            error instanceof Error ? error.message : String(error)
          }).`,
          tables,
        });
      }

      const outcome = await this.semantica.query({
        cypher: generated.cypher,
        params: normalizeParams(generated.params),
        limit,
      });

      if (outcome.ok) {
        // 行回来了、却一条引用都没有：这些行没有可回溯的来源，而"可审计"是这条
        // 链路的硬要求。提示词已经要求返回 `r.prov`，但提示词是自律不是保证，
        // 所以这里按"可纠正"处理——带着具体提示重写一次（只一次）。
        const rowsWithoutProvenance =
          outcome.value.rows.length > 0 &&
          outcome.value.citations.length === 0 &&
          outcome.value.citationsError == null;
        if (
          rowsWithoutProvenance &&
          !provenanceRetried &&
          attempt < SEMANTICA_MAX_GENERATION_ATTEMPTS &&
          Date.now() - startedAt < SEMANTICA_REASONING_BUDGET_MS
        ) {
          provenanceRetried = true;
          this.logger.warn(
            `Ontology query returned ${String(outcome.value.rows.length)} row(s) with no provenance; asking for a rewrite that returns \`prov\` (attempt ${String(attempt)}).`,
          );
          previousCypher = generated.cypher;
          previousErrorKind = MISSING_PROVENANCE_ERROR_KIND;
          previousError =
            `The statement ran and returned ${String(outcome.value.rows.length)} row(s), ` +
            'but no provenance id came back. Every relationship in this graph ' +
            'carries a `prov` property; add it to the projection ' +
            '(`r.prov AS prov`) for each relationship the answer uses.';
          continue;
        }

        return this.buildSuccessEnvelope({
          question,
          limit,
          cypher: generated.cypher,
          rationale: generated.rationale ?? null,
          outcome: outcome.value,
          attempts: attempt,
          graph: graphSchema.graph,
          tables,
        });
      }

      this.logger.warn(
        `Ontology query rejected (attempt ${String(attempt)}/${String(SEMANTICA_MAX_GENERATION_ATTEMPTS)}, kind=${outcome.failure.kind}, errorKind=${outcome.failure.errorKind ?? 'none'}): ${outcome.failure.reason}`,
      );

      // 不可纠正的失败（未配置 / 连不上 / 鉴权 / sidecar 5xx）立刻返回：
      // 把"服务不可用"伪装成"图上查不到"是本模块反复出现过的错误。
      if (!isRetryableSemanticaFailure(outcome.failure)) {
        return this.buildUnavailableEnvelope({
          question,
          limit,
          reason: `Ontology reasoning is unavailable: ${outcome.failure.reason}`,
          tables,
        });
      }

      previousCypher = generated.cypher;
      previousErrorKind = outcome.failure.errorKind;
      previousError = outcome.failure.detail ?? outcome.failure.reason;
    }

    return this.buildGenerationFailureEnvelope({
      question,
      limit,
      attempts: SEMANTICA_MAX_GENERATION_ATTEMPTS,
      lastCypher: previousCypher,
      lastError: previousError,
      graph: graphSchema.graph,
      tables,
      reason: `Ontology reasoning could not produce an executable query after ${String(SEMANTICA_MAX_GENERATION_ATTEMPTS)} attempts: ${previousError ?? 'unknown error'}`,
    });
  }

  /**
   * 生成侧失败（重试次数或预算用尽）的信封。
   *
   * 与"服务不可用"分开：这里图上是有断言的，只是没生成出可执行的查询——
   * 两者对模型的含义不同，合并会诱导它把"我不会问"说成"图上没有"。
   */
  private buildGenerationFailureEnvelope(input: {
    question: string;
    limit: number;
    attempts: number;
    lastCypher: string | null;
    lastError: string | null;
    graph: string;
    tables: string[];
    reason: string;
  }): AssistantReadResultEnvelope {
    this.logger.warn(input.reason);

    return this.buildEnvelope({
      question: input.question,
      limit: input.limit,
      result: {
        ...buildEmptyResult(),
        cypher: input.lastCypher,
        attempts: input.attempts,
        graph: input.graph,
        sourceTier: SEMANTICA_SOURCE_TIER,
        sourceNote: SOURCE_TIER_NOTE,
        lastError: input.lastError,
      },
      coverage: { status: 'empty', reason: input.reason },
      confidence: {
        level: 'low',
        reason: 'Query generation failed; no evidence was read.',
      },
      verifiability: 'unavailable',
      tables: input.tables,
    });
  }

  private buildSuccessEnvelope(input: {
    question: string;
    limit: number;
    cypher: string;
    rationale: string | null;
    outcome: SemanticaQueryOutcome;
    attempts: number;
    graph: string;
    tables: string[];
  }): AssistantReadResultEnvelope {
    const budget = applyRowBudget(input.outcome.rows);
    const truncated = input.outcome.truncated || budget.dropped;
    const rowCount = budget.rows.length;

    const coverage: AssistantReadCoverage =
      rowCount === 0
        ? {
            status: 'empty',
            reason:
              'The ontology graph has no edge matching this question. That means the source data asserts no such relationship — not that none exists.',
          }
        : truncated
          ? {
              status: 'partial',
              reason: `Result truncated to ${String(rowCount)} rows.`,
            }
          : { status: 'complete', reason: null };

    const confidence: AssistantReadConfidence =
      rowCount === 0
        ? {
            level: 'low',
            reason:
              'No matching assertion exists in the English-side knowledge graph.',
          }
        : truncated
          ? {
              level: 'medium',
              reason: 'Ontology reasoning returned a truncated result set.',
            }
          : {
              level: 'high',
              reason:
                'Deterministic Cypher over DrugBank structured facts; the executed query is returned for review.',
            };

    const citations = input.outcome.citations
      .slice(0, ONTOLOGY_MAX_CITATIONS)
      .map((citation) => ({
        id: citation.id,
        entityType: citation.entityType,
        sourceDocument: citation.sourceDocument,
        sourceLocation: citation.sourceLocation,
        sourceQuote: citation.sourceQuote,
        activityId: citation.activityId,
        agentId: citation.agentId,
        confidence: citation.confidence,
        sequenceId: citation.sequenceId,
        checksum: citation.checksum,
        parentEntityId: citation.parentEntityId,
      }));
    // 引用被截断时如实说：一份看起来完整的引用列表会让"每条断言都可回溯"
    // 变成一句无法核实的话。
    const citationsTruncated =
      input.outcome.citationsTruncated ||
      input.outcome.citations.length > citations.length;

    return this.buildEnvelope({
      question: input.question,
      limit: input.limit,
      result: {
        cypher: input.cypher,
        rationale: input.rationale,
        graph: input.graph,
        columns: input.outcome.columns,
        rows: budget.rows,
        rowCount,
        truncated,
        attempts: input.attempts,
        elapsedMs: input.outcome.elapsedMs,
        sourceTier: SEMANTICA_SOURCE_TIER,
        sourceNote: SOURCE_TIER_NOTE,
        citations,
        citationCount: input.outcome.citations.length,
        citationsTruncated,
        citationsMissing: input.outcome.citationsMissing,
        citationsError: input.outcome.citationsError,
        citationNote: CITATION_NOTE,
      },
      coverage,
      confidence,
      verifiability: resolveVerifiability(rowCount, citations.length),
      tables: input.tables,
    });
  }

  /** 服务不可用 / 未配置 / 生成失败：明确的"没有证据可读"，不是"确实没有"。 */
  private buildUnavailableEnvelope(input: {
    question: string;
    limit: number;
    reason: string;
    tables: string[];
  }): AssistantReadResultEnvelope {
    this.logger.warn(input.reason);

    return this.buildEnvelope({
      question: input.question,
      limit: input.limit,
      result: buildEmptyResult(),
      coverage: { status: 'empty', reason: input.reason },
      confidence: {
        level: 'low',
        reason: 'Reasoning service unavailable — no evidence was read.',
      },
      verifiability: 'unavailable',
      tables: input.tables,
    });
  }

  private buildEnvelope(input: {
    question: string;
    limit: number;
    result: Record<string, unknown>;
    coverage: AssistantReadCoverage;
    confidence: AssistantReadConfidence;
    verifiability: string;
    tables: string[];
  }): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'reason_over_ontology',
      query: { question: input.question, limit: input.limit },
      result: { ...input.result, verifiability: input.verifiability },
      coverage: input.coverage,
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: input.confidence,
      ambiguities: [],
      tables: input.tables,
    });
  }
}

function buildEmptyResult(): Record<string, unknown> {
  return {
    cypher: null,
    rationale: null,
    columns: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    attempts: 0,
  };
}

/**
 * 参数解析：`question` 必填，`limit` 越界即夹到合法区间。
 *
 * 返回判别式联合而不是抛异常：非法参数是正常的"模型给错了"情形，应该变成
 * 一个可读的空信封让模型自我纠正，而不是把整条 graph 打挂。
 */
function parseArguments(
  toolArgs: Record<string, unknown> | undefined,
):
  | { ok: true; question: string; limit: number }
  | { ok: false; question: string; limit: number; reason: string } {
  const args = toolArgs ?? {};
  const rawQuestion =
    typeof args['question'] === 'string' ? args['question'] : '';
  const question = rawQuestion.trim();
  const limit = normalizeLimit(args['limit']);

  if (question.length === 0) {
    return {
      ok: false,
      question,
      limit,
      reason: `${INVALID_ARGUMENT_PREFIX}: "question" must not be empty.`,
    };
  }

  return { ok: true, question, limit };
}

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== 'number' || Number.isNaN(limit)) {
    return SEMANTICA_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(SEMANTICA_MAX_LIMIT, Math.trunc(limit)));
}

/** 只放行标量参数：sidecar 会把它转义成字面量，复合值没有意义。 */
function normalizeParams(
  params: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      normalized[key] = value;
    }
  }
  return normalized;
}

/** 按序列化体积裁剪行，返回是否发生裁剪。 */
function applyRowBudget(rows: readonly Record<string, unknown>[]): {
  rows: Record<string, unknown>[];
  dropped: boolean;
} {
  const kept: Record<string, unknown>[] = [];
  let used = 0;

  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (kept.length > 0 && used + size > MAX_RESULT_CHARS) {
      return { rows: kept, dropped: true };
    }
    kept.push(row);
    used += size;
  }

  return { rows: kept, dropped: false };
}
