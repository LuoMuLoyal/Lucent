import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import type {
  SemanticaCallFailure,
  SemanticaCitation,
  SemanticaGraphSchema,
  SemanticaQueryErrorKind,
  SemanticaQueryOutcome,
} from './semantica.types.js';
import { SEMANTICA_QUERY_ERROR_KINDS } from './semantica.types.js';

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
  errorKind: SemanticaQueryErrorKind | null;
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
      errorKind:
        typeof kind === 'string' && isQueryErrorKind(kind) ? kind : null,
      message: typeof message === 'string' ? message : null,
    };
    // eslint-disable-next-line error-handling/no-silent-catch -- 非 JSON body，调用方 classifyHttpError 已把同一条 body 记进 warn
  } catch {
    // 网关 HTML 之类的非 JSON body：没有结构化信息，交给上层按 server_error 处理。
    return { errorKind: null, message: null };
  }
}

function isQueryErrorKind(value: string): value is SemanticaQueryErrorKind {
  return (SEMANTICA_QUERY_ERROR_KINDS as readonly string[]).includes(value);
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
