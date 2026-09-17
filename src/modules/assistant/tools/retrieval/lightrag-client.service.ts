import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import type {
  LightragCallFailure,
  LightragChunk,
  LightragQueryMode,
  LightragQueryOutcome,
  LightragSource,
} from './lightrag.types.js';
import {
  LIGHTRAG_DEFAULT_MODE,
  LIGHTRAG_METADATA_LEAFLET_ID,
  LIGHTRAG_METADATA_SOURCE_FIELD,
} from './lightrag.types.js';

/**
 * Lucent → LightRAG sidecar 的 HTTP 客户端。
 *
 * 只做三件事：解析配置、发请求、把上游形态归一成 {@link LightragQueryOutcome}
 * 或 {@link LightragCallFailure}。检索语义（选哪个 workspace、允不允许某个 mode、
 * envelope 长什么样）都在工具层，不在这一层——这样"能不能追问一句"的规则只有
 * 一处，客户端保持纯粹。
 *
 * 失败一律返回判别式结果而不是抛异常：调用方（工具服务）必须能把"检索服务不可用"
 * 与"确实没有证据"区分开，而异常会诱使调用方用一个 catch 把两者合成"没有证据"
 * ——那正是计划 §一.7 明确禁止的静默降级。
 */
@Injectable()
export class LightragClientService {
  private readonly logger = new Logger(LightragClientService.name);

  private readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.enabled =
      this.configService.get<string>(EnvKey.LIGHTRAG_ENABLED) === 'true';
    this.baseUrl = (
      this.configService.get<string>(EnvKey.LIGHTRAG_BASE_URL) ??
      'http://lightrag:9621'
    ).replace(/\/+$/, '');
    const apiKey =
      this.configService.get<string>(EnvKey.LIGHTRAG_API_KEY)?.trim() ?? '';
    this.apiKey = apiKey.length > 0 ? apiKey : null;
    this.timeoutMs =
      this.configService.get<number>(EnvKey.LIGHTRAG_TIMEOUT_MS) ?? 8000;

    if (this.enabled && this.apiKey == null) {
      // 启动期 zod 交叉校验已拦过这一条；这里兜住"运行中被改了配置"的窄情形，
      // 且不抛异常——模块构造期抛错会让整个 assistant 模块起不来。
      this.logger.warn(
        `${EnvKey.LIGHTRAG_ENABLED} is true but ${EnvKey.LIGHTRAG_API_KEY} is empty; retrieval calls will fail as disabled.`,
      );
    }
  }

  /** sidecar 是否已启用且具备鉴权条件。 */
  isEnabled(): boolean {
    return this.enabled && this.apiKey != null;
  }

  /** 未启用时的统一失败结果，供工具层直接产出"未配置"信封。 */
  buildDisabledFailure(): LightragCallFailure {
    return {
      kind: 'disabled',
      reason: 'LightRAG retrieval is not configured.',
      status: null,
    };
  }

  /**
   * 检索上下文（**只取上下文，绝不 generate**）。
   *
   * 固定带 `only_need_context=true` + `include_chunk_content=true`：否则 LightRAG
   * 会自己生成一段答案——那既是双重生成（Lucent 的 agent 还要再生成一次），也绕开
   * 了 Lucent 的安全层（计划 §5.3.5）。
   */
  async query(input: {
    workspace: string;
    query: string;
    mode?: LightragQueryMode;
    limit: number;
  }): Promise<
    | { ok: true; value: LightragQueryOutcome }
    | { ok: false; failure: LightragCallFailure }
  > {
    if (!this.isEnabled()) {
      return { ok: false, failure: this.buildDisabledFailure() };
    }

    const response = await this.request('/query', {
      method: 'POST',
      workspace: input.workspace,
      body: {
        query: input.query,
        mode: input.mode ?? LIGHTRAG_DEFAULT_MODE,
        only_need_context: true,
        include_references: true,
        include_chunk_content: true,
        chunk_top_k: input.limit,
      },
    });

    if (!response.ok) {
      return { ok: false, failure: response.failure };
    }

    const parsed = parseQueryResponse(response.payload);
    if (parsed == null) {
      return {
        ok: false,
        failure: {
          kind: 'malformed_response',
          reason: 'LightRAG returned an unreadable query response.',
          status: response.status,
        },
      };
    }

    return { ok: true, value: parsed };
  }

  /**
   * 判断 sidecar 是否可达（用于 capabilities/健康检查，不参与检索主链）。
   *
   * 不做重试：这是探活，不是取数；把"慢"当成"不可用"是这里的正确取舍。
   */
  async health(): Promise<{ ok: boolean; reason: string | null }> {
    if (!this.isEnabled()) {
      return { ok: false, reason: this.buildDisabledFailure().reason };
    }

    const response = await this.request('/health', {
      method: 'GET',
      workspace: null,
      body: null,
    });

    return response.ok
      ? { ok: true, reason: null }
      : { ok: false, reason: response.failure.reason };
  }

  /**
   * 发一次请求并把非 2xx / 网络错误归一成 {@link LightragCallFailure}。
   *
   * `timeoutMs` 是**客户端**超时：它比工具级 `TOOL_EXECUTION_TIMEOUT_MS` 短，
   * 这样超时原因能由本层说清楚（"检索超时"）而不是落到工具层那个笼统的
   * "Tool execution timed out."。
   */
  private async request(
    path: string,
    options: {
      method: 'GET' | 'POST';
      workspace: string | null;
      body: Record<string, unknown> | null;
    },
  ): Promise<
    | { ok: true; status: number; payload: unknown }
    | { ok: false; failure: LightragCallFailure }
  > {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey ?? ''}`,
    };
    if (options.workspace != null && options.workspace.length > 0) {
      headers['LIGHTRAG-WORKSPACE'] = options.workspace;
    }
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
      // 网络层失败（超时/连接拒绝/DNS）在这里落地为判别式结果，绝不抛出：
      // 调用方必须能把"服务不可用"与"确实没有证据"分开（计划 §一.7）。
      this.logger.warn(
        `LightRAG request failed (url=${url}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { ok: false, failure: this.classifyNetworkError(error) };
    }

    if (!response.ok) {
      return {
        ok: false,
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
        `LightRAG returned non-JSON body (url=${url}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        ok: false,
        failure: {
          kind: 'malformed_response',
          reason: 'LightRAG returned a non-JSON response.',
          status: response.status,
        },
      };
    }
  }

  private classifyNetworkError(error: unknown): LightragCallFailure {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');

    return isTimeout
      ? {
          kind: 'timeout',
          reason: `LightRAG retrieval timed out after ${String(this.timeoutMs)}ms.`,
          status: null,
        }
      : {
          kind: 'unreachable',
          reason: 'LightRAG retrieval service is unreachable.',
          status: null,
        };
  }

  private async classifyHttpError(
    response: Response,
    url: string,
  ): Promise<LightragCallFailure> {
    // 只读一小段 body：错误响应可能带一大段 HTML，日志与 envelope 都不需要它。
    // 读 body 失败不影响分类（状态码已经足够判定），但仍要记一条 warn。
    let detail = '';
    try {
      detail = await response.text();
    } catch (error) {
      this.logger.warn(
        `LightRAG error body was unreadable (url=${url}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const status = response.status;

    this.logger.warn(
      `LightRAG returned ${String(status)} (url=${url}): ${detail.slice(0, 300)}`,
    );

    if (status === 401 || status === 403) {
      return {
        kind: 'unauthorized',
        reason: 'LightRAG rejected the configured API key.',
        status,
      };
    }
    if (status === 400 || status === 422) {
      return {
        kind: 'bad_request',
        reason: 'LightRAG rejected the retrieval request.',
        status,
      };
    }
    return {
      kind: 'server_error',
      reason: 'LightRAG retrieval service failed.',
      status,
    };
  }
}

/**
 * 把 `/query` 响应归一成 chunks。
 *
 * `only_need_context=true` 时 `response` 字段承载的是拼好的上下文文本，逐 chunk
 * 明细在 `references[].content`（一个文件路径下的多个 chunk）；同一份说明书的多个
 * 字段会各自成为一个 document，所以 `file_path` 才能反解出 leafletId/sourceField
 * —— 这正是灌数据时把稳定 doc id 写进 `file_source` 的用途。
 *
 * 返回 null 表示响应结构不是预期形态（调用方按 malformed_response 处理）。
 */
function parseQueryResponse(payload: unknown): LightragQueryOutcome | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }

  const references = (payload as Record<string, unknown>)['references'];
  if (references != null && !Array.isArray(references)) {
    return null;
  }

  const chunks: LightragChunk[] = [];
  let hasUnmappedChunk = false;

  for (const reference of (references ?? []) as unknown[]) {
    if (reference == null || typeof reference !== 'object') {
      continue;
    }

    const record = reference as Record<string, unknown>;
    const filePath =
      typeof record['file_path'] === 'string' ? record['file_path'] : '';
    const contents = record['content'];
    if (!Array.isArray(contents)) {
      continue;
    }

    const metadata = parseDocIdMetadata(filePath);
    if (metadata == null && filePath.length > 0) {
      hasUnmappedChunk = true;
    }

    for (const content of contents) {
      if (typeof content !== 'string' || content.length === 0) {
        continue;
      }
      chunks.push({
        text: content,
        rank: chunks.length + 1,
        score: null,
        filePath,
        leafletId: metadata?.leafletId ?? null,
        sourceField: metadata?.sourceField ?? null,
      });
    }
  }

  return { chunks, hasUnmappedChunk };
}

/**
 * 从灌入时写入的 doc id 反解溯源信息。
 *
 * doc id 形如 `leaflet:<leafletId>:<sourceField>:<chunkIndex>`（灌数据脚本写入
 * `file_source`，LightRAG 原样回传为 `file_path`）。解析不出来就返回 null，
 * 由调用方标 `coverage: partial`，而不是猜一个 leafletId。
 */
function parseDocIdMetadata(
  filePath: string,
): { leafletId: string; sourceField: string } | null {
  const parts = filePath.split(':');
  if (parts.length < 4 || parts[0] !== 'leaflet') {
    return null;
  }

  const leafletId = parts[1];
  const sourceField = parts[2];
  if (leafletId == null || leafletId.length === 0) {
    return null;
  }
  if (sourceField == null || sourceField.length === 0) {
    return null;
  }

  return { leafletId, sourceField };
}

/**
 * 归一 metadata key 的读取入口（供灌数据与工具层共用），避免两侧各写一份字符串。
 */
export const LIGHTRAG_DOC_ID_METADATA_KEYS = {
  leafletId: LIGHTRAG_METADATA_LEAFLET_ID,
  sourceField: LIGHTRAG_METADATA_SOURCE_FIELD,
} as const;

export type { LightragSource };
