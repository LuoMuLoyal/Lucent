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
  errorKind: SemanticaQueryErrorKind | null;
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

/** `POST /query` 的成功结果。 */
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
