import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import type {
  SemanticaCallFailure,
  SemanticaCitation,
  SemanticaDerivedConclusion,
  SemanticaErrorKind,
  SemanticaGraphSchema,
  SemanticaQueryOutcome,
  SemanticaReasonOutcome,
  SemanticaRuleInfo,
} from './semantica.types.js';
import {
  SEMANTICA_QUERY_ERROR_KINDS,
  SEMANTICA_REASON_ERROR_KINDS,
} from './semantica.types.js';

/**
 * 与 zod 校验层默认值一致的兜底值（zod `.default()` 已写入 process.env，
 * 这里只兜住"直接构造 ConfigService 的测试/异常路径"）。
 */
const FALLBACK_BASE_URL = 'http://semantica:8099';
const FALLBACK_TIMEOUT_MS = 15000;

/** 错误 body 只截前 300 字符进日志：日志要的是线索，不是整段 HTML。 */
const MAX_ERROR_BODY_LOG_CHARS = 300;

/** HTTP 状态码分类边界。 */
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
/** 5xx 是服务端故障，与"查询被拒"（4xx）是两类：前者重试没有意义。 */
const HTTP_STATUS_SERVER_ERROR = 500;

/**
 * Lucent → Semantica sidecar（英文侧 OAG）的 HTTP 客户端。
 *
 * 与 LightRAG 客户端的职责切分一致：只做「解析配置、发请求、把上游形态归一成
 * 判别式结果」。查询语义（生成什么 Cypher、允不允许重试、envelope 长什么样）
 * 都在工具层，客户端保持纯粹。
 *
 * **没有 API key。** sidecar 是我们自己的服务、只在内网 compose 网络上
 * （不发布宿主端口、不挂 Traefik），且它自身不持有任何模型凭据 —— 与 LightRAG
 * 需要密钥握手的情形不同（上游产品自带鉴权）。要暴露给公网时必须先加鉴权。
 *
 * 失败一律返回判别式结果而不是抛异常：调用方必须能把"推理服务不可用"与
 * "图上确实查不到"区分开，异常会诱使调用方用一个 catch 把两者合成"没有证据"
 * ——那正是计划反复点名的静默降级。
 */
@Injectable()
export class SemanticaClientService {
  private readonly logger = new Logger(SemanticaClientService.name);

  private readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.enabled =
      this.configService.get<string>(EnvKey.SEMANTICA_ENABLED) === 'true';
    this.baseUrl = (
      this.configService.get<string>(EnvKey.SEMANTICA_BASE_URL) ??
      FALLBACK_BASE_URL
    ).replace(/\/+$/, '');
    this.timeoutMs =
      this.configService.get<number>(EnvKey.SEMANTICA_TIMEOUT_MS) ??
      FALLBACK_TIMEOUT_MS;
  }

  /** sidecar 是否已启用。 */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** 未启用时的统一失败结果，供工具层直接产出"未配置"信封。 */
  buildDisabledFailure(): SemanticaCallFailure {
    return {
      kind: 'disabled',
      reason: 'Ontology reasoning is not configured.',
      status: null,
      errorKind: null,
      detail: null,
    };
  }

  /**
   * 读图的结构（标签 / 关系类型及其数量）。
   *
   * 这是生成 Cypher 的前置输入：prompt 里只允许出现这里列出的名字，
   * schema 变了 prompt 自动跟着变（计划 §3.5 ② 的"解决漂移"）。
   */
  async schema(): Promise<
    | { ok: true; value: SemanticaGraphSchema }
    | { ok: false; failure: SemanticaCallFailure }
  > {
    const response = await this.request('/schema', {
      method: 'GET',
      body: null,
    });
    if (!response.ok) {
      return { ok: false, failure: response.failure };
    }

    const parsed = parseSchemaResponse(response.payload);
    if (parsed == null) {
      return {
        ok: false,
        failure: this.buildMalformedFailure(
          response.status,
          'Semantica returned an unreadable schema response.',
        ),
      };
    }

    return { ok: true, value: parsed };
  }

  /**
   * 执行一条**只读** Cypher。
   *
   * 只读、单条、必须带 LIMIT 的纪律由 sidecar 守卫强制（它会返回结构化的
   * `kind`），本层不重复实现——守卫只有一处，漂移才不会发生。
   */
  async query(input: {
    cypher: string;
    params: Record<string, string | number | boolean>;
    limit: number;
  }): Promise<
    | { ok: true; value: SemanticaQueryOutcome }
    | { ok: false; failure: SemanticaCallFailure }
  > {
    if (!this.isEnabled()) {
      return { ok: false, failure: this.buildDisabledFailure() };
    }

    const response = await this.request('/query', {
      method: 'POST',
      body: {
        cypher: input.cypher,
        params: input.params,
        limit: input.limit,
        // 引用与行一起取：分成两次调用会让"哪些行对应哪些引用"重新变成猜测。
        include_provenance: true,
      },
    });

    if (!response.ok) {
      return { ok: false, failure: response.failure };
    }

    const parsed = parseQueryResponse(response.payload);
    if (parsed == null) {
      return {
        ok: false,
        failure: this.buildMalformedFailure(
          response.status,
          'Semantica returned an unreadable query response.',
        ),
      };
    }

    return { ok: true, value: parsed };
  }

  /**
   * 枚举规则库（`GET /rules`）。
   *
   * 有了它，intent 才是可发现的：模型不该靠猜规则 id，也不该被硬编码在提示词里
   * ——规则库改一条，提示词就漂移一次。读回的是规则自己声明的 intent 与摘要。
   */
  async rules(): Promise<
    | { ok: true; value: readonly SemanticaRuleInfo[] }
    | { ok: false; failure: SemanticaCallFailure }
  > {
    if (!this.isEnabled()) {
      return { ok: false, failure: this.buildDisabledFailure() };
    }

    const response = await this.request('/rules', {
      method: 'GET',
      body: null,
    });
    if (!response.ok) {
      return { ok: false, failure: response.failure };
    }

    const parsed = parseRulesResponse(response.payload);
    if (parsed == null) {
      return {
        ok: false,
        failure: this.buildMalformedFailure(
          response.status,
          'Semantica returned an unreadable rule library.',
        ),
      };
    }

    return { ok: true, value: parsed };
  }

  /**
   * 按规则推导（`POST /reason`）。
   *
   * 与 {@link query} 的分别不是"另一个端点"，而是**另一种断言**：`/query` 读的是
   * 图上的断言，`/reason` 返回的是规则推导出来的结论，并带上每条结论的前提引用。
   * 上层必须把两者分开呈现（计划 §3.4 约束 4），所以这里也返回不同的类型。
   *
   * `scope` 让 sidecar 只导出被问到的子图。省略它意味着在全图上做不动点——
   * 那不是"更全"，而是把一个分钟级的计算塞进一个秒级的工具调用。
   */
  async reason(input: {
    intent: string;
    query: string;
    scope: {
      drugNames?: readonly string[];
      atcPrefixes?: readonly string[];
    };
    limit: number;
  }): Promise<
    | { ok: true; value: SemanticaReasonOutcome }
    | { ok: false; failure: SemanticaCallFailure }
  > {
    if (!this.isEnabled()) {
      return { ok: false, failure: this.buildDisabledFailure() };
    }

    const response = await this.request('/reason', {
      method: 'POST',
      body: {
        load_from_graph: true,
        intent: input.intent,
        query: input.query,
        scope: {
          drug_names: input.scope.drugNames ?? [],
          atc_prefixes: input.scope.atcPrefixes ?? [],
        },
        limit: input.limit,
      },
    });

    if (!response.ok) {
      return { ok: false, failure: response.failure };
    }

    const parsed = parseReasonResponse(response.payload, input.query);
    if (parsed == null) {
      return {
        ok: false,
        failure: this.buildMalformedFailure(
          response.status,
          'Semantica returned an unreadable reasoning response.',
        ),
      };
    }

    return { ok: true, value: parsed };
  }

  /**
   * 判断 sidecar 是否可达（用于健康检查，不参与推理主链）。
   *
   * 不做重试：这是探活，不是取数。
   */
  async health(): Promise<{ ok: boolean; reason: string | null }> {
    if (!this.isEnabled()) {
      return { ok: false, reason: this.buildDisabledFailure().reason };
    }

    const response = await this.request('/health', {
      method: 'GET',
      body: null,
    });
    return response.ok
      ? { ok: true, reason: null }
      : { ok: false, reason: response.failure.reason };
  }

  /**
   * 发一次请求并把非 2xx / 网络错误归一成 {@link SemanticaCallFailure}。
   *
   * `timeoutMs` 是**客户端**超时：它比工具级 `TOOL_EXECUTION_TIMEOUT_MS` 短，
   * 这样超时原因能由本层说清楚而不是落到工具层那个笼统的 "Tool execution
   * timed out."。
   */
  private async request(
    path: string,
    options: { method: 'GET' | 'POST'; body: Record<string, unknown> | null },
  ): Promise<
    | { ok: true; status: number; payload: unknown }
    | { ok: false; status: number; failure: SemanticaCallFailure }
  > {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {};
    if (options.body != null) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        // exactOptionalPropertyTypes: `undefined` 不能赋给 BodyInit | null，显式用 null。
        body: options.body == null ? null : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      this.logger.warn(
        `Semantica request failed (url=${url}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        ok: false,
        status: 0,
        failure: this.classifyNetworkError(error),
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        failure: await this.classifyHttpError(response, url),
      };
    }

    try {
      return {
        ok: true,
        status: response.status,
        payload: await response.json(),
      };
    } catch (error) {
      this.logger.warn(
        `Semantica returned non-JSON body (url=${url}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        ok: false,
        status: response.status,
        failure: this.buildMalformedFailure(
          response.status,
          'Semantica returned a non-JSON response.',
        ),
      };
    }
  }

  private buildMalformedFailure(
    status: number,
    reason: string,
  ): SemanticaCallFailure {
    return {
      kind: 'malformed_response',
      reason,
      status,
      errorKind: null,
      detail: null,
    };
  }

  private classifyNetworkError(error: unknown): SemanticaCallFailure {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');

    return isTimeout
      ? {
          kind: 'timeout',
          reason: `Ontology reasoning timed out after ${String(this.timeoutMs)}ms.`,
          status: null,
          errorKind: null,
          detail: null,
        }
      : {
          kind: 'unreachable',
          reason: 'Ontology reasoning service is unreachable.',
          status: null,
          errorKind: null,
          detail: null,
        };
  }

  /**
   * 把 sidecar 的结构化报错（`{"detail": {"kind", "message"}}`，见
   * semantica-service `routes/query.py`）连同 pydantic 的数组形态校验错误
   * 一并归一。`kind` 是重试回路的判据，取不到时按 server_error 处理。
   */
  private async classifyHttpError(
    response: Response,
    url: string,
  ): Promise<SemanticaCallFailure> {
    let body = '';
    try {
      body = await response.text();
    } catch (error) {
      this.logger.warn(
        `Semantica error body was unreadable (url=${url}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const status = response.status;
    this.logger.warn(
      `Semantica returned ${String(status)} (url=${url}): ${body.slice(0, MAX_ERROR_BODY_LOG_CHARS)}`,
    );

    if (
      status === HTTP_STATUS_UNAUTHORIZED ||
      status === HTTP_STATUS_FORBIDDEN
    ) {
      return {
        kind: 'unauthorized',
        reason: 'Semantica rejected the request.',
        status,
        errorKind: null,
        detail: null,
      };
    }

    if (
      status >= HTTP_STATUS_BAD_REQUEST &&
      status < HTTP_STATUS_SERVER_ERROR
    ) {
      const parsed = parseErrorDetail(body);
      return {
        kind: 'rejected',
        reason: parsed.message ?? 'Semantica rejected the query.',
        status,
        errorKind: parsed.errorKind,
        detail: parsed.message,
      };
    }

    return {
      kind: 'server_error',
      reason: 'Ontology reasoning service failed.',
      status,
      errorKind: null,
      detail: null,
    };
  }
}

/** 解析错误 body，取出结构化 `kind` 与可读 message。 */
function parseErrorDetail(body: string): {
  errorKind: SemanticaErrorKind | null;
  message: string | null;
} {
  try {
    const payload: unknown = JSON.parse(body);
    if (payload == null || typeof payload !== 'object') {
      return { errorKind: null, message: null };
    }
    const detail = (payload as Record<string, unknown>)['detail'];
    if (detail == null || typeof detail !== 'object' || Array.isArray(detail)) {
      return {
        errorKind: null,
        message: typeof detail === 'string' ? detail : null,
      };
    }
    const record = detail as Record<string, unknown>;
    const kind = record['kind'];
    const message = record['message'];
    return {
      // 两个端点各有自己的 kind 词表，这里接受并集：只认 `/query` 那一组会让
      // `/reason` 的 `scope_matched_nothing` 被读成 null，上层于是把"你的范围
      // 没命中"报成"推理服务不可用"——一个可修正的输入问题被伪装成基础设施
      // 故障，模型转而用别的方式猜答案。
      errorKind:
        typeof kind === 'string' && isKnownErrorKind(kind) ? kind : null,
      message: typeof message === 'string' ? message : null,
    };
    // eslint-disable-next-line error-handling/no-silent-catch -- 非 JSON body，调用方 classifyHttpError 已把同一条 body 记进 warn
  } catch {
    // 网关 HTML 之类的非 JSON body：没有结构化信息，交给上层按 server_error 处理。
    return { errorKind: null, message: null };
  }
}

function isKnownErrorKind(value: string): value is SemanticaErrorKind {
  return (
    (SEMANTICA_QUERY_ERROR_KINDS as readonly string[]).includes(value) ||
    (SEMANTICA_REASON_ERROR_KINDS as readonly string[]).includes(value)
  );
}

function parseSchemaResponse(payload: unknown): SemanticaGraphSchema | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const graph = record['graph'];
  if (typeof graph !== 'string') {
    return null;
  }

  return {
    graph,
    nodeCount: readCount(record['node_count']),
    relationshipCount: readCount(record['relationship_count']),
    labels: parseLabelCounts(record['labels']),
    relationshipTypes: parseLabelCounts(record['relationship_types']),
  };
}

function parseLabelCounts(value: unknown): { label: string; count: number }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: { label: string; count: number }[] = [];
  for (const item of value as unknown[]) {
    if (item == null || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const label = record['label'];
    if (typeof label !== 'string' || label.length === 0) {
      continue;
    }
    entries.push({ label, count: readCount(record['count']) });
  }
  return entries;
}

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseQueryResponse(payload: unknown): SemanticaQueryOutcome | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const rows = record['rows'];
  const columns = record['columns'];
  if (!Array.isArray(rows) || !Array.isArray(columns)) {
    return null;
  }

  const parsedRows: Record<string, unknown>[] = [];
  for (const row of rows as unknown[]) {
    if (row == null || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }
    parsedRows.push(row as Record<string, unknown>);
  }

  return {
    columns: (columns as unknown[]).filter(
      (column): column is string => typeof column === 'string',
    ),
    rows: parsedRows,
    rowCount: readCount(record['row_count']),
    truncated: record['truncated'] === true,
    elapsedMs: readCount(record['elapsed_ms']),
    citations: parseCitations(record['provenance']),
    citationsMissing: readStringArray(record['provenance_missing']),
    citationsTruncated: record['provenance_truncated'] === true,
    citationsError:
      typeof record['provenance_error'] === 'string'
        ? record['provenance_error']
        : null,
  };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as unknown[]).filter(
    (item): item is string => typeof item === 'string',
  );
}

function parseRulesResponse(payload: unknown): SemanticaRuleInfo[] | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const rules = (payload as Record<string, unknown>)['rules'];
  if (!Array.isArray(rules)) {
    return null;
  }

  const parsed: SemanticaRuleInfo[] = [];
  for (const entry of rules as unknown[]) {
    const rule = parseRuleInfo(entry);
    if (rule != null) {
      parsed.push(rule);
    }
  }
  return parsed;
}

function parseRuleInfo(value: unknown): SemanticaRuleInfo | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = readOptionalString(record['id']);
  if (id == null) {
    return null;
  }
  return {
    id,
    intent: readOptionalString(record['intent']) ?? '',
    summary: readOptionalString(record['summary']) ?? '',
    citationHint: readOptionalString(record['citation_hint']) ?? '',
    consumes: readStringArray(record['consumes']),
    derives: readOptionalString(record['derives']) ?? '',
  };
}

function parseReasonResponse(
  payload: unknown,
  query: string,
): SemanticaReasonOutcome | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const conclusions = record['conclusions'];
  if (!Array.isArray(conclusions)) {
    return null;
  }

  const bindings = parseBindings(record['bindings']);
  const parsedConclusions: SemanticaDerivedConclusion[] = [];
  for (const entry of conclusions as unknown[]) {
    const conclusion = parseConclusion(entry);
    if (conclusion != null) {
      parsedConclusions.push(conclusion);
    }
  }

  return {
    factCount: readCount(record['fact_count']),
    bindings,
    // 合并在这一层做一次：sidecar 的绑定行只有变量，钉死的常量只在查询模式里。
    // 上层若各自去拼，总有一次会漏。
    groundedBindings: groundBindings(bindings, query),
    conclusions: parsedConclusions,
    conclusionsComplete: record['conclusions_complete'] === true,
    rule: parseRuleInfo(record['rule']),
  };
}

function parseBindings(value: unknown): Record<string, string>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parsed: Record<string, string>[] = [];
  for (const row of value as unknown[]) {
    if (row == null || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }
    const binding: Record<string, string> = {};
    for (const [key, entry] of Object.entries(row as Record<string, unknown>)) {
      if (typeof entry === 'string') {
        binding[key] = entry;
      }
    }
    parsed.push(binding);
  }
  return parsed;
}

/**
 * 把查询模式里钉死的常量补进绑定行。
 *
 * sidecar 的 `query('potential_ddi(db00682, ?B)')` 返回的行**只有变量**——实测
 * `[{B: 'db04951'}, ...]`，常量 `db00682` 根本不在行里。因此只读绑定行的调用方
 * 会以为 A 没绑定，进而选不出任何结论。常量要从模式里取，变量从行里取。
 *
 * 模式解析失败时原样返回：这一层不猜。上层会因为缺少常量而少拼出结论，那是
 * 可见的偏差，好过这里凭空造一个值。
 */
function groundBindings(
  bindings: readonly Record<string, string>[],
  query: string,
): Record<string, string>[] {
  const constants = readPatternConstants(query);
  if (constants == null) {
    return [...bindings];
  }
  return bindings.map((row) => ({ ...constants, ...row }));
}

/**
 * 查询模式里钉死的实参：变量位置留空，常量位置给值。
 *
 * 与 sidecar 的 `_pinned_arguments` 是同一条规则的两侧实现。刻意不共享代码：
 * 两侧是独立部署的进程，共享的只有线上契约，把一侧的内部函数当成另一侧的依赖
 * 会让"独立部署"变成一句空话。
 */
function readPatternConstants(query: string): Record<string, string> | null {
  const open = query.indexOf('(');
  const close = query.lastIndexOf(')');
  if (open === -1 || close <= open) {
    return null;
  }
  const args = query
    .slice(open + 1, close)
    .split(',')
    .map((arg) => arg.trim());
  if (args.length !== 2) {
    return null;
  }

  const constants: Record<string, string> = {};
  // 规则的 head 变量按位置命名 A、B（见规则库）；模式里写常量就是不绑定。
  const names = ['A', 'B'] as const;
  names.forEach((name, index) => {
    const arg = args[index] ?? '';
    if (arg.length > 0 && !arg.startsWith('?')) {
      constants[name] = arg;
    }
  });
  return Object.keys(constants).length > 0 ? constants : null;
}

function parseConclusion(value: unknown): SemanticaDerivedConclusion | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const fact = readOptionalString(record['fact']);
  if (fact == null) {
    return null;
  }
  return {
    fact,
    subject: readOptionalString(record['subject']) ?? '',
    predicate: readOptionalString(record['predicate']) ?? '',
    object: readOptionalString(record['object']) ?? '',
    ruleId: readOptionalString(record['rule_id']) ?? '',
    citations: readStringArray(record['citations']),
    uncitedPremises: readStringArray(record['uncited_premises']),
  };
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 引用列表。unknown 形状按字段逐个读：sidecar 是独立部署的进程，它的响应
 * 漂移不该让整个查询结果作废——读不懂的那条直接丢掉，行本身仍然有效。
 */
function parseCitations(value: unknown): SemanticaCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const citations: SemanticaCitation[] = [];
  for (const item of value as unknown[]) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = record['id'];
    if (typeof id !== 'string' || id.length === 0) {
      continue;
    }
    const metadata = record['metadata'];
    citations.push({
      id,
      entityType: readOptionalString(record['entity_type']) ?? 'unknown',
      sourceDocument: readOptionalString(record['source_document']) ?? '',
      sourceLocation: readOptionalString(record['source_location']) ?? '',
      sourceQuote: readOptionalString(record['source_quote']) ?? '',
      activityId: readOptionalString(record['activity_id']),
      agentId: readOptionalString(record['agent_id']),
      agentType: readOptionalString(record['agent_type']),
      confidence: readOptionalNumber(record['confidence']),
      timestamp: readOptionalString(record['timestamp']),
      sequenceId: readOptionalNumber(record['sequence_id']),
      checksum: readOptionalString(record['checksum']),
      parentEntityId: readOptionalString(record['parent_entity_id']),
      metadata:
        metadata != null &&
        typeof metadata === 'object' &&
        !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>)
          : {},
    });
  }
  return citations;
}
