/**
 * 英文侧 OAG（Semantica sidecar）的类型与常量。
 *
 * 边界（计划 §3.4 约束 1）：这一层只做「读 + 推理」，**不做生成**——用户可见的
 * 答案始终由 Lucent 的 agent 生成。NL→Cypher 的生成放在 Lucent（§3.5 ②），
 * sidecar 只负责校验与执行，因此 sidecar 自身不需要 LLM 凭据。
 */

/** 单次 Cypher 返回给模型的默认行数上限。 */
export const SEMANTICA_DEFAULT_LIMIT = 25;

/** 单次 Cypher 返回给模型的行数硬上限（与 sidecar 的 limit 上限一致）。 */
export const SEMANTICA_MAX_LIMIT = 100;

/**
 * 规则推理读取子图的**边数**上限。
 *
 * 与 {@link SEMANTICA_MAX_LIMIT} 不是同一个预算，刻意不复用：那个是"返回给模型
 * 的行数"（25/100），这个是"喂进不动点引擎的边数"。把两者当成一个数，要么让
 * 推理范围小到推不出东西，要么让范围大到把工具调用拖进超时。
 *
 * 2000 是实测标定：导出侧已从 57s 优化到 50,000 条边 12.7s，但不动点还叠在
 * 那之上，且代价随范围超线性增长。2000 条边在秒级完成，足够覆盖一个药及其
 * 代谢网络，因此默认取保守值。
 */
export const SEMANTICA_REASON_DEFAULT_LIMIT = 2000;

/** 规则推理子图的边数硬上限（与 sidecar 的 limit 上界一致）。 */
export const SEMANTICA_REASON_MAX_LIMIT = 20_000;

/**
 * 生成 + 执行的总尝试次数。
 *
 * 重试回路是**生产必需**而非优化：试点实测模型会产出 `OPTIONAL MATCH ... AS x`
 * 这类非法语法（计划 §8.1 风险 2），把 sidecar 的结构化报错回喂模型即可自纠。
 * 1 次首试 + 2 次纠错。
 */
export const SEMANTICA_MAX_GENERATION_ATTEMPTS = 3;

/**
 * 单次工具调用内「生成 + 重试」的软时间预算。
 *
 * 与工具层的执行超时（`ONTOLOGY_TOOL_EXECUTION_TIMEOUT_MS` = 45s）是两道不同的闸：
 * 这里是工具自知的预算——用尽就停下并如实说"预算用尽"，而不是让工具层把整次调用
 * 掐成一个没有上下文的 "Tool execution timed out."。取 30s 的理由：单次尝试最坏
 * 情形是模型超时 10s + sidecar 超时 20s，留出一次完整尝试的余量。
 */
export const SEMANTICA_REASONING_BUDGET_MS = 30_000;

/** 本体图断言的来源等级：DrugBank 结构化字段确定性灌入，非 LLM 抽取。 */
export const SEMANTICA_SOURCE_TIER = 'drugbank_structured';

/**
 * sidecar `/query` 拒绝时返回的结构化错误类别。
 *
 * 与 semantica-service 的契约一一对应（见该仓 `routes/query.py`）：
 * 它是重试回路的判据——可纠正的类别回喂模型重生成，基础设施类直接放弃。
 */
export const SEMANTICA_QUERY_ERROR_KINDS = [
  'not_read_only',
  'multiple_statements',
  'syntax_error',
  'unsupported_feature',
  'timeout',
  'internal',
] as const;

export type SemanticaQueryErrorKind =
  (typeof SEMANTICA_QUERY_ERROR_KINDS)[number];

/**
 * `/reason` 拒绝时返回的结构化错误类别。
 *
 * 与 {@link SEMANTICA_QUERY_ERROR_KINDS} 分开：那一组是**语句**的问题（语法、
 * 只读、AGE 不支持），这一组是**请求**的问题（范围、事实上限、超时）。合并成
 * 一组会让"重试是否有意义"这个判据失真——改写 Cypher 修不了空范围。
 */
export const SEMANTICA_REASON_ERROR_KINDS = [
  'fact_limit_exceeded',
  'scope_matched_nothing',
  'input_too_large',
  'timeout',
] as const;

export type SemanticaReasonErrorKind =
  (typeof SEMANTICA_REASON_ERROR_KINDS)[number];

/**
 * 两个端点拒绝类别的并集。
 *
 * `SemanticaCallFailure.errorKind` 用它而不是某个端点的词表：失败是**跨端点**
 * 共享的形状，而"这个 kind 属于哪个端点"由产生它的那次调用决定，不由类型决定。
 */
export type SemanticaErrorKind =
  | SemanticaQueryErrorKind
  | SemanticaReasonErrorKind;

/**
 * 该失败是否**由调用方可以改正的输入问题**引起。
 *
 * 参数取整个并集而不是 {@link SemanticaReasonErrorKind}：判据的输入是
 * {@link SemanticaCallFailure.errorKind}，而它的类型是并集。收窄参数类型只会
 * 逼调用方写一次无从保证的断言——那正是这个判据要消除的猜测。
 *
 * 这个判据决定信封怎么说话，而两者的差别不是措辞：
 * - 是（范围没命中 / 范围太大 / 事实超限）→ 调用方给了可修正的输入，答案应当
 *   说"你的范围有问题"，而不是"推理服务不可用"。说成后者，模型会把它当成
 *   一次基础设施故障，转而用别的方式猜答案。
 * - 否（连不上 / 未配置 / 5xx / 语法错误）→ 没有证据可读，这才是 `unavailable`。
 */
export function isAddressableReasonRejection(
  errorKind: SemanticaErrorKind | null,
): errorKind is SemanticaReasonErrorKind {
  return (
    errorKind === 'scope_matched_nothing' ||
    errorKind === 'fact_limit_exceeded' ||
    errorKind === 'input_too_large'
  );
}

/** 调用失败类别（与 LightRAG 客户端同形，便于两条 sidecar 链路一致处理）。 */
export type SemanticaFailureKind =
  | 'disabled'
  | 'timeout'
  | 'unreachable'
  | 'unauthorized'
  | 'rejected'
  | 'server_error'
  | 'malformed_response';

export interface SemanticaCallFailure {
  kind: SemanticaFailureKind;
  reason: string;
  status: number | null;
  /** sidecar 给出的结构化错误类别（仅 `rejected` 时有值）。 */
  errorKind: SemanticaErrorKind | null;
  /** 可回喂模型的原文（AGE / 语法报错），重试回路用它自纠。 */
  detail: string | null;
}

/** `GET /schema` 的一句话摘要：图里有标签与关系类型各多少。 */
export interface SemanticaGraphSchema {
  graph: string;
  nodeCount: number;
  relationshipCount: number;
  labels: readonly { label: string; count: number }[];
  relationshipTypes: readonly { label: string; count: number }[];
}

/**
 * `POST /reason` 的结果：按规则推导出的结论及其前提引用。
 *
 * 与 {@link SemanticaQueryOutcome} 是**两类不同的东西**，不共用 envelope 字段：
 * `/query` 返回的是图上**断言**的行，`/reason` 返回的是规则**推导**出来的结论。
 * 计划 §3.4 约束 4 要求两者绝不可同形呈现——一条推导结论看起来像一条断言，
 * 就等于把"我们推出来的"说成"数据里写的"。
 */
export interface SemanticaReasonOutcome {
  /** 推导出的全部事实数（不只是本次查询命中的）。 */
  factCount: number;
  /**
   * 规则查询的绑定行：只有变量，没有查询模式里钉死的常量。
   *
   * 这一点会误导调用方：`potential_ddi(db00682, ?B)` 返回的行是 `{B: ...}`，
   * 常量 `db00682` 不在行里。要还原完整结论必须同时读查询模式，因此本层把
   * 模式解析好之后与绑定行**合并**成 {@link groundedBindings} 再交给上层——
   * 让上层每次都得记得这件事，迟早会有人忘。
   */
  bindings: readonly Record<string, string>[];
  /** 补全了模式常量的绑定行，与 `conclusions` 的定义域一致。 */
  groundedBindings: readonly Record<string, string>[];
  conclusions: readonly SemanticaDerivedConclusion[];
  /**
   * 是否每一条结论的前提都查过了。
   *
   * `false` 不等于"没有证据"：它意味着恢复提前停了（见 `MAX_RECOVERED`）。
   * 把两者合并，就会把一条只是没查的结论说成一条查不到的结论。
   */
  conclusionsComplete: boolean;
  /** 应用的规则（intent 命中的那一条）。 */
  rule: SemanticaRuleInfo | null;
}

/**
 * 一条推导结论。
 *
 * `citations` 是这个类型里最重要的字段：一条结论的名字不构成证据，它引用的
 * 前提行才构成证据。`uncitedPremises` 非空表示这条结论**部分**建立在无法引用
 * 的前提上——不丢弃它，但也不能当作完全可核验。
 */
export interface SemanticaDerivedConclusion {
  /** 完整事实，形如 `potential_ddi(db00682, db09213)`。 */
  fact: string;
  subject: string;
  predicate: string;
  object: string;
  ruleId: string;
  /** 溯源引用 id 列表；空表示前提一行都没引用到。 */
  citations: readonly string[];
  /** 无法解析出引用 id 的前提事实（不该被当成"没有前提"）。 */
  uncitedPremises: readonly string[];
}

/** 规则库中一条规则的元信息（`/reason` 的 `rule` 字段）。 */
export interface SemanticaRuleInfo {
  id: string;
  intent: string;
  summary: string;
  /** 引用纪律：告诉模型该引用什么，而不是只引用结论。 */
  citationHint: string;
  consumes: readonly string[];
  derives: string;
}

/**
 * `/query` 返回的结果行。
 *
 * 推导结论**不能**走这个类型：这是"图上断言的行"，`SemanticaDerivedConclusion`
 * 是"规则推导出的结论"。两个类型分开是刻意的（见 {@link SemanticaReasonOutcome}）。
 */
export interface SemanticaQueryOutcome {
  columns: readonly string[];
  rows: readonly Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  /**
   * 该查询所依赖断言的溯源引用。
   *
   * 引用不是查询结果的装饰，而是它可复核的那一半：`id` 指回来源表与来源行，
   * `checksum` 指回导入期写入的哈希链。空数组是有意义的——要么 Cypher 没有
   * 返回 `prov`，要么那些 id 不在审计库里；`citationsMissing` 与
   * `citationsError` 负责区分。
   */
  citations: readonly SemanticaCitation[];
  citationsMissing: readonly string[];
  citationsTruncated: boolean;
  citationsError: string | null;
}

/**
 * 一条溯源引用（sidecar 的 `provenance[]` 元素）。
 *
 * 字段是 sidecar 响应（snake_case）的驼峰投影：两侧是独立部署的进程，映射
 * 只在这一层做一次，上层的 envelope 不必知道对端的命名习惯。
 */
export interface SemanticaCitation {
  /** 溯源 id，形如 `lucent:<来源表>/<行键>`；引用与复核都按它。 */
  id: string;
  entityType: string;
  sourceDocument: string;
  sourceLocation: string;
  sourceQuote: string;
  activityId: string | null;
  agentId: string | null;
  agentType: string | null;
  confidence: number | null;
  timestamp: string | null;
  sequenceId: number | null;
  checksum: string | null;
  parentEntityId: string | null;
  metadata: Record<string, unknown>;
}

/**
 * 该失败是否值得让模型改写后重试。
 *
 * 只有「查询本身有问题」才重试：读-only 守卫、语法、AGE 不支持的构造、以及
 * 单条查询超时（模型可以收窄查询）。基础设施类失败（未配置 / 连不上 / 鉴权 /
 * 5xx）重试多少次都一样，只会把工具耗时翻几倍。
 */
export function isRetryableSemanticaFailure(
  failure: SemanticaCallFailure,
): boolean {
  if (failure.kind !== 'rejected') {
    return false;
  }
  return (
    failure.errorKind === 'not_read_only' ||
    failure.errorKind === 'multiple_statements' ||
    failure.errorKind === 'syntax_error' ||
    failure.errorKind === 'unsupported_feature' ||
    failure.errorKind === 'timeout'
  );
}
