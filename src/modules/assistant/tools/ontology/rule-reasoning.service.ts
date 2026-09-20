import { Injectable, Logger } from '@nestjs/common';
import type {
  AssistantReadConfidence,
  AssistantReadCoverage,
  AssistantReadResultEnvelope,
  AssistantToolExecutionContext,
} from '../../types/assistant.types.js';
import { buildReadEnvelope } from '../presenters.js';
import { SemanticaClientService } from './semantica-client.service.js';
import type {
  SemanticaDerivedConclusion,
  SemanticaReasonOutcome,
} from './semantica.types.js';
import {
  isAddressableReasonRejection,
  SEMANTICA_REASON_DEFAULT_LIMIT,
  SEMANTICA_REASON_MAX_LIMIT,
  SEMANTICA_SOURCE_TIER,
} from './semantica.types.js';

/** 该工具在参数边界拒绝非法入参的统一前缀。 */
const INVALID_ARGUMENT_PREFIX = 'Invalid reason_over_rules arguments';

/**
 * 进 envelope 的结论条数上限。
 *
 * 比 `reason_over_ontology` 的 25 行更小，理由不是"结论更贵"而是**结论更危险**：
 * 一条推导结论看起来就像一条断言，20 条并列陈列时读者会把它当成 20 条事实。
 * 上限压小，配合每条都带 `ruleId` 与前提引用，让"这是推出来的"这件事在体量上
 * 就说得通。
 */
const MAX_CONCLUSIONS = 20;

/**
 * 进 envelope 的前提引用条数上限。
 *
 * 一条结论可能有多个前提（`potential_ddi` 是"抑制某酶"+"是该酶底物"）。按
 * {@link MAX_CONCLUSIONS} × 每条最多 8 个前提留量，超出就截断并如实标注。
 */
const MAX_CITATIONS = 160;

/**
 * 结果序列化预算（字符）。
 *
 * 与直读工具同样的道理：条数上限不等于体积上限，一条结论可能带一长串引用。
 */
const MAX_RESULT_CHARS = 16000;

const SOURCE_TIER_NOTE =
  'DrugBank structured facts, ingested deterministically (no LLM extraction).';

/**
 * 推导结论的呈现纪律（计划 §3.4 约束 4）。
 *
 * 这段话会进模型上下文，因此它不是给人看的注释，而是**给模型的行为约束**：
 * 推导结论绝不能与断言同形呈现。写成常量而非散落在各处，是因为它必须在每个
 * 出口都出现——少一个出口，模型就有一次机会把推导说成事实。
 */
const DERIVED_NOTE =
  'These are conclusions the rule derives from asserted edges, not edges the graph contains. State them as derived ("X may interact with Y because both act on Z"), never as facts the data asserts. Each conclusion names the rule that produced it and cites the assertions it rests on; cite those ids, not the conclusion.';

const SCOPE_NOTE =
  'Reasoning ran over the scope you named, not the whole graph. A conclusion is only as complete as that scope, so an empty result means this scope derived nothing — not that the relationship does not exist.';

/**
 * 输入被拒时的统一前缀。
 *
 * 让"范围问题"在 envelope 里一眼可辨：模型据此知道该改范围重问，而不是把
 * 这次调用读成一次故障。
 */
const SCOPE_REJECTION_PREFIX =
  'The reasoning request was refused because of its scope, not because of a service failure: ';

/**
 * 英文侧规则推理工具：`reason_over_rules`（计划 R3）。
 *
 * 与 `reason_over_ontology` 的分工是**断言与推导的分别**，不是"另一个端点"：
 * - `reason_over_ontology` 读图上**写了**的边（"谁抑制了这个酶"）。
 * - `reason_over_rules` 按规则**推出**图上没写的边（"A 抑制的酶恰好是 B 的
 *   代谢酶，所以 A 可能影响 B"）。后者的依据不在任何一个三元组里，而在两个
 *   三元组的**连接**上。
 *
 * 因此这个工具的硬要求比直读更严：每条结论必须带规则 id 和前提引用，且必须在
 * envelope 里与断言区分开呈现。一条没有前提引用的推导结论不是"证据较弱"，而是
 * 一句无法核实的断言。
 *
 * 范围是必填而非可选：推导的代价随子图规模超线性增长，不给范围就是把分钟级的
 * 计算塞进一个秒级的工具调用，而超时会被读成"图上没有"。
 */
@Injectable()
export class AssistantToolRuleReasoningService {
  private readonly logger = new Logger(AssistantToolRuleReasoningService.name);

  constructor(private readonly semantica: SemanticaClientService) {}

  async reasonOverRules(
    context: AssistantToolExecutionContext,
  ): Promise<AssistantReadResultEnvelope> {
    const parsed = parseArguments(context.toolArgs);

    if (!parsed.ok) {
      return this.buildEnvelope({
        intent: parsed.intent,
        query: parsed.query,
        limit: parsed.limit,
        drugNames: parsed.drugNames,
        atcPrefixes: parsed.atcPrefixes,
        result: buildEmptyResult(parsed.query),
        coverage: { status: 'empty', reason: parsed.reason },
        confidence: { level: 'low', reason: parsed.reason },
        verifiability: 'unavailable',
      });
    }

    const { intent, query, limit, drugNames, atcPrefixes } = parsed;

    if (!this.semantica.isEnabled()) {
      return this.buildUnavailableEnvelope({
        intent,
        query,
        limit,
        drugNames,
        atcPrefixes,
        reason:
          'Rule reasoning is not configured on this deployment; the English-side knowledge graph cannot be reasoned over.',
      });
    }

    const outcome = await this.semantica.reason({
      intent,
      query,
      scope: { drugNames, atcPrefixes },
      limit,
    });

    if (!outcome.ok) {
      // 「服务不可用」与「你的输入有问题」必须分开，这不是措辞问题：
      // 说成 unavailable，模型会把它当成一次基础设施故障，转而用别的方式猜答案；
      // 说成 scope，它才会去改范围重问。两者都返回空结果，但一个指向可修正的
      // 输入，另一个指向没有证据可读——本模块反复点名的静默降级正是把前者说成后者。
      if (isAddressableReasonRejection(outcome.failure.errorKind)) {
        return this.buildRejectedEnvelope({
          intent,
          query,
          limit,
          drugNames,
          atcPrefixes,
          reason: `${SCOPE_REJECTION_PREFIX}${outcome.failure.reason}`,
          errorKind: outcome.failure.errorKind,
        });
      }
      return this.buildUnavailableEnvelope({
        intent,
        query,
        limit,
        drugNames,
        atcPrefixes,
        reason: `Rule reasoning is unavailable: ${outcome.failure.reason}`,
        errorKind: outcome.failure.errorKind,
      });
    }

    return this.buildSuccessEnvelope({
      intent,
      query,
      limit,
      drugNames,
      atcPrefixes,
      outcome: outcome.value,
    });
  }

  private buildSuccessEnvelope(input: {
    intent: string;
    query: string;
    limit: number;
    drugNames: readonly string[];
    atcPrefixes: readonly string[];
    outcome: SemanticaReasonOutcome;
  }): AssistantReadResultEnvelope {
    const { outcome } = input;

    // 引用在放行之前先截断：一份"看起来完整"的引用列表会让"每条结论都可回溯"
    // 变成一句无法核实的话，所以截断必须可见。
    const allCitations = collectCitations(outcome.conclusions);
    const citations = allCitations.slice(0, MAX_CITATIONS);
    const citationsTruncated = allCitations.length > citations.length;

    const budget = applyConclusionBudget(outcome.conclusions);

    // 结论在条数上被裁、或在体积上被裁，都是 partial——两者都会让模型看到一份
    // 不完整的推导，而它无从知道少了什么。
    const truncated =
      budget.dropped || outcome.conclusions.length > budget.conclusions.length;

    const coverage = buildCoverage({
      conclusionCount: budget.conclusions.length,
      truncated,
      scopeTruncated: !outcome.conclusionsComplete,
      scopeDrugCount: input.drugNames.length,
      scopeAtcCount: input.atcPrefixes.length,
    });

    const confidence = buildConfidence(budget.conclusions, truncated);
    const uncitedCount = budget.conclusions.filter(
      (conclusion) => conclusion.citations.length === 0,
    ).length;

    return this.buildEnvelope({
      intent: input.intent,
      query: input.query,
      limit: input.limit,
      drugNames: input.drugNames,
      atcPrefixes: input.atcPrefixes,
      result: {
        // 与直读工具刻意不同名：`cypher` 变成 `rule` + `query`。同名会让"执行的
        // 是什么"在两处含义不同，而下游若按名字取值就会把规则当成查询。
        rule: outcome.rule,
        query: input.query,
        graph: SEMANTICA_SOURCE_TIER,
        conclusions: budget.conclusions.map((conclusion) => ({
          fact: conclusion.fact,
          subject: conclusion.subject,
          predicate: conclusion.predicate,
          object: conclusion.object,
          ruleId: conclusion.ruleId,
          citations: conclusion.citations,
          uncitedPremises: conclusion.uncitedPremises,
        })),
        conclusionCount: budget.conclusions.length,
        derivedFactCount: outcome.factCount,
        truncated,
        conclusionsComplete: outcome.conclusionsComplete,
        citations,
        citationCount: allCitations.length,
        citationsTruncated,
        // 无引用的结论条数单列：调用方据此判断"能引用的结论"到底有几条，
        // 而不必自己遍历一遍（遍历就总会有人忘）。
        uncitedConclusionCount: uncitedCount,
        derivedNote: DERIVED_NOTE,
        scopeNote: SCOPE_NOTE,
        sourceTier: SEMANTICA_SOURCE_TIER,
        sourceNote: SOURCE_TIER_NOTE,
      },
      coverage,
      confidence,
      // 有结论但一条引用都没有 → `uncited`。这正是这个工具存在的意义的反面：
      // 不能因为"是确定性推出的"就默认可核验。
      verifiability: resolveVerifiability(
        budget.conclusions.length,
        citations.length,
      ),
    });
  }

  /**
   * 调用方**可以修正的输入问题**（范围没命中 / 范围过大 / 事实超限）的信封。
   *
   * 与 {@link buildUnavailableEnvelope} 分开是刻意的：两者的空结果长得一样，
   * 指向的原因却相反。合并会让一次"换个药名再问"变成一次"推理坏了"，而模型
   * 对后者的反应是放弃这条推理路径。
   *
   * `verifiability` 仍是 `unavailable`：没有推导出任何结论，也就没有可核验的
   * 东西——可修正 ≠ 有证据。
   */
  private buildRejectedEnvelope(input: {
    intent: string;
    query: string;
    limit: number;
    drugNames: readonly string[];
    atcPrefixes: readonly string[];
    reason: string;
    errorKind: string;
  }): AssistantReadResultEnvelope {
    this.logger.warn(input.reason);

    return this.buildEnvelope({
      intent: input.intent,
      query: input.query,
      limit: input.limit,
      drugNames: input.drugNames,
      atcPrefixes: input.atcPrefixes,
      result: {
        ...buildEmptyResult(input.query),
        errorKind: input.errorKind,
      },
      coverage: { status: 'empty', reason: input.reason },
      confidence: {
        level: 'low',
        reason:
          'The request was refused before reasoning ran; no conclusion was derived.',
      },
      verifiability: 'unavailable',
    });
  }

  private buildUnavailableEnvelope(input: {
    intent: string | null;
    query: string | null;
    limit: number;
    drugNames: readonly string[];
    atcPrefixes: readonly string[];
    reason: string;
    errorKind?: string | null;
  }): AssistantReadResultEnvelope {
    this.logger.warn(input.reason);

    return this.buildEnvelope({
      intent: input.intent,
      query: input.query,
      limit: input.limit,
      drugNames: input.drugNames,
      atcPrefixes: input.atcPrefixes,
      result: {
        ...buildEmptyResult(input.query),
        errorKind: input.errorKind ?? null,
      },
      coverage: { status: 'empty', reason: input.reason },
      confidence: {
        level: 'low',
        reason: 'Rule reasoning unavailable — no conclusion was derived.',
      },
      verifiability: 'unavailable',
    });
  }

  private buildEnvelope(input: {
    intent: string | null;
    query: string | null;
    limit: number;
    drugNames: readonly string[];
    atcPrefixes: readonly string[];
    result: Record<string, unknown>;
    coverage: AssistantReadCoverage;
    confidence: AssistantReadConfidence;
    verifiability: string;
  }): AssistantReadResultEnvelope {
    return buildReadEnvelope({
      toolName: 'reason_over_rules',
      query: {
        intent: input.intent,
        query: input.query,
        scope: {
          drugNames: [...input.drugNames],
          atcPrefixes: [...input.atcPrefixes],
        },
        limit: input.limit,
        verifiability: input.verifiability,
      },
      result: input.result,
      coverage: input.coverage,
      // 推理没有时间轴，与 `reason_over_ontology` 一样显式给 null 而不是省略：
      // 省略会让下游把"不适用"与"忘了填"混起来。
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      confidence: input.confidence,
      // 范围为空会让结论集为空，这是最容易被误读成"没有关系"的一种空。
      ambiguities: buildAmbiguities(input),
      tables: ['lucent_graph (Apache AGE, rule-derived)'],
    });
  }
}

/**
 * 空结果是**关于范围**的结论，必须写清楚，否则模型会把"这个范围推不出"说成
 * "不存在这种关系"。
 */
function buildAmbiguities(input: {
  drugNames: readonly string[];
  atcPrefixes: readonly string[];
  coverage: AssistantReadCoverage;
}): string[] {
  const ambiguities: string[] = [SCOPE_NOTE];
  if (input.drugNames.length === 0 && input.atcPrefixes.length === 0) {
    ambiguities.push(
      'No scope was supplied, so the reasoning had nothing to run over.',
    );
  }
  if (input.coverage.status === 'empty') {
    ambiguities.push(
      'An empty conclusion set is a finding about the scope you named.',
    );
  }
  return ambiguities;
}

function buildCoverage(input: {
  conclusionCount: number;
  truncated: boolean;
  scopeTruncated: boolean;
  scopeDrugCount: number;
  scopeAtcCount: number;
}): AssistantReadCoverage {
  if (input.scopeDrugCount === 0 && input.scopeAtcCount === 0) {
    return {
      status: 'empty',
      reason:
        'No scope was supplied. Rule reasoning runs over an explicit drug or ATC scope, so nothing was derived.',
    };
  }
  if (input.scopeTruncated) {
    return {
      status: 'partial',
      reason:
        'The reasoning ran over a derived-fact set larger than the recovery bound, so some conclusions have no citations attached. Treat uncited conclusions as unattributed rather than as uncitable.',
    };
  }
  if (input.conclusionCount === 0) {
    return {
      status: 'empty',
      reason:
        'The rule derived nothing within this scope. That is a statement about the scope and the rule, not evidence that the relationship is absent.',
    };
  }
  if (input.truncated) {
    return {
      status: 'partial',
      reason: `The conclusion set was truncated to the first ${String(input.conclusionCount)} entries.`,
    };
  }
  return { status: 'complete', reason: null };
}

function buildConfidence(
  conclusions: readonly SemanticaDerivedConclusion[],
  truncated: boolean,
): AssistantReadConfidence {
  if (conclusions.length === 0) {
    return {
      level: 'low',
      reason: 'The rule derived no conclusion within the given scope.',
    };
  }
  const uncited = conclusions.filter(
    (conclusion) => conclusion.citations.length === 0,
  ).length;
  if (uncited > 0) {
    return {
      level: 'medium',
      reason: `${String(uncited)} of ${String(conclusions.length)} conclusions cite no premise; those are attributed to a rule but not to evidence.`,
    };
  }
  if (truncated) {
    return {
      level: 'medium',
      reason: 'The conclusion set was truncated.',
    };
  }
  return {
    level: 'high',
    reason:
      'Deterministic fixpoint over DrugBank structured facts; every conclusion names its rule and cites its premises.',
  };
}

/**
 * 有结论且**有引用**才叫 `citable`。
 *
 * 与直读工具同一条纪律，但在这里更严格：推导的结论越像事实，越需要"能不能
 * 核实"的明示。
 */
function resolveVerifiability(
  conclusionCount: number,
  citationCount: number,
): string {
  if (conclusionCount === 0) {
    return 'citable';
  }
  return citationCount > 0 ? 'citable' : 'uncited';
}

function collectCitations(
  conclusions: readonly SemanticaDerivedConclusion[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const conclusion of conclusions) {
    for (const citation of conclusion.citations) {
      if (!seen.has(citation)) {
        seen.add(citation);
        ordered.push(citation);
      }
    }
  }
  return ordered;
}

/**
 * 按条数与序列化体积裁剪结论，返回是否发生裁剪。
 *
 * 与行预算同样的道理：条数上限不等于体积上限，一条结论可能带一长串引用。
 */
function applyConclusionBudget(
  conclusions: readonly SemanticaDerivedConclusion[],
): { conclusions: SemanticaDerivedConclusion[]; dropped: boolean } {
  const kept: SemanticaDerivedConclusion[] = [];
  let used = 0;

  for (const conclusion of conclusions) {
    if (kept.length >= MAX_CONCLUSIONS) {
      return { conclusions: kept, dropped: true };
    }
    const size = JSON.stringify(conclusion).length;
    if (kept.length > 0 && used + size > MAX_RESULT_CHARS) {
      return { conclusions: kept, dropped: true };
    }
    kept.push(conclusion);
    used += size;
  }

  return { conclusions: kept, dropped: false };
}

function buildEmptyResult(query: string | null): Record<string, unknown> {
  return {
    rule: null,
    query,
    conclusions: [],
    conclusionCount: 0,
    derivedFactCount: 0,
    citations: [],
    citationCount: 0,
    citationsTruncated: false,
    uncitedConclusionCount: 0,
    derivedNote: DERIVED_NOTE,
    scopeNote: SCOPE_NOTE,
  };
}

type ParsedArguments =
  | {
      ok: true;
      intent: string;
      query: string;
      limit: number;
      drugNames: string[];
      atcPrefixes: string[];
    }
  | {
      ok: false;
      reason: string;
      intent: string | null;
      query: string | null;
      limit: number;
      drugNames: string[];
      atcPrefixes: string[];
    };

/**
 * 解析并校验工具入参。
 *
 * 范围在这里是**硬要求**：`intent` 与 `query` 缺一不可，且至少给一种范围。
 * 让它们可选再在服务端兜底成"全图"，等于把一个必然超时的请求伪装成一次正常
 * 调用——而超时下来会被读成"图上没有"。
 */
function parseArguments(raw: unknown): ParsedArguments {
  const args = readArgumentsRecord(raw);
  const intent = readNonEmptyString(args['intent']);
  const query = readNonEmptyString(args['query']);
  const drugNames = readStringList(args['drug_names']);
  const atcPrefixes = readStringList(args['atc_prefixes']);
  const limit = readLimit(args['limit']);

  const base = { intent, query, limit, drugNames, atcPrefixes };

  if (intent == null) {
    return {
      ok: false,
      reason: `${INVALID_ARGUMENT_PREFIX}: 'intent' is required and must name a rule library entry.`,
      ...base,
    };
  }
  if (query == null) {
    return {
      ok: false,
      reason: `${INVALID_ARGUMENT_PREFIX}: 'query' is required and must be a Datalog conclusion pattern such as 'potential_ddi(DB00682, ?B)'.`,
      ...base,
    };
  }
  if (drugNames.length === 0 && atcPrefixes.length === 0) {
    return {
      ok: false,
      reason: `${INVALID_ARGUMENT_PREFIX}: a scope is required — supply 'drug_names' or 'atc_prefixes'. Reasoning over the whole graph is refused rather than run: it would time out, and a timeout reads as "nothing found".`,
      ...base,
    };
  }
  // 一个都没钉死的模式等于"把整个结论集给我"，那不是提问，而是倾倒。
  if (!pinsAnArgument(query)) {
    return {
      ok: false,
      reason: `${INVALID_ARGUMENT_PREFIX}: 'query' must pin at least one argument to a constant, e.g. 'potential_ddi(DB00682, ?B)'. A pattern that pins nothing is refused rather than answered.`,
      ...base,
    };
  }

  return { ok: true, intent, query, limit, drugNames, atcPrefixes };
}

/**
 * 模式里是否至少钉死了一个实参。
 *
 * 全变量模式（`potential_ddi(?A, ?B)`）在语义上成立，但它的答案是整个结论集
 * ——实测单药范围就有 20,116 条。那不是"问一个药理问题"，而是让工具把子图的
 * 全部推导倒进上下文。
 */
function pinsAnArgument(query: string): boolean {
  const open = query.indexOf('(');
  const close = query.lastIndexOf(')');
  if (open === -1 || close <= open) {
    return false;
  }
  return query
    .slice(open + 1, close)
    .split(',')
    .some((arg) => {
      const trimmed = arg.trim();
      return trimmed.length > 0 && !trimmed.startsWith('?');
    });
}

function readArgumentsRecord(raw: unknown): Record<string, unknown> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as unknown[])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return SEMANTICA_REASON_DEFAULT_LIMIT;
  }
  if (value < 1) {
    return SEMANTICA_REASON_DEFAULT_LIMIT;
  }
  return Math.min(value, SEMANTICA_REASON_MAX_LIMIT);
}
