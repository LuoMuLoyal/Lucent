/**
 * LightRAG sidecar 的客户端契约（类型 + 常量）。
 *
 * 这一层只描述"Lucent 怎么调 LightRAG"，不描述 LightRAG 自己的存储/模型配置
 * —— 后者只存在于 sidecar 的独立 env 文件里（见 `deploy/lightrag/`）。
 *
 * 上游事实源（2026-09-18 对照 HKUDS/LightRAG main 源码 + v1.5.7 实测）：
 * - `POST /query` → `{ response, references: [{ reference_id, file_path, content? }] }`，
 *   `content` 仅在 `include_chunk_content=true` 时出现；
 * - `POST /documents/texts` → `{ texts: string[], file_sources?: string[] }`；
 * - `POST /documents/delete_document` → `{ doc_ids: string[] }`；
 * - `GET /health`；
 * - workspace 经 `LIGHTRAG-WORKSPACE` 头选择；
 * - 鉴权经 **`X-API-Key`** 头（`Authorization` 是 OAuth2 登录令牌专用，发 Bearer
 *   会被当成非法令牌判 401 `Invalid token`——实测踩过，见客户端注释）。
 */

/**
 * LightRAG 检索模式。
 *
 * `bypass` 刻意**不在**此联合里：它绕过检索直接问 LLM，会绕开 Lucent 的安全层
 * 造成双重生成（计划 §5.3.4），所以服务端在参数边界就拒绝它，而不是"传下去再说"。
 */
export const LIGHTRAG_QUERY_MODES = [
  'naive',
  'local',
  'global',
  'hybrid',
  'mix',
] as const;

export type LightragQueryMode = (typeof LIGHTRAG_QUERY_MODES)[number];

/**
 * 已知的危险 mode：必须**点名**拒绝，而不是落进"未知 mode"的通用分支。
 *
 * 上游认得这些值，所以它们不是笔误——是能用、但不该用的模式。`bypass` 绕过检索
 * 直接问 LLM，既是双重生成也绕开了 Lucent 的安全层（计划 §5.3.4）。列在这里而不是
 * 在工具层写 `raw === 'bypass'`：将来上游再加一个同类模式时，只需要在这个词表里
 * 补一项，不必到调用点找那行字面量比较。
 */
export const LIGHTRAG_REJECTED_MODES = ['bypass'] as const;

/** Lucent 侧允许模型选择的检索来源（服务端映射到 workspace，模型不能直接指定 workspace 名）。 */
export const LIGHTRAG_SOURCES = ['leaflet', 'qa'] as const;

export type LightragSource = (typeof LIGHTRAG_SOURCES)[number];

/** 默认检索模式：纯 chunk 向量检索，不碰图（计划 §一.3）。 */
export const LIGHTRAG_DEFAULT_MODE: LightragQueryMode = 'naive';

/** 默认 / 最大返回条数（计划 §5.2）。 */
export const LIGHTRAG_DEFAULT_LIMIT = 4;
export const LIGHTRAG_MAX_LIMIT = 8;

/**
 * 把 `LIGHTRAG_GRAPH_SOURCES`（逗号分隔）解析成来源集合。
 *
 * 语义是"**这些来源的知识图谱已经建好了**"——即它们可以接受图模式
 * （`local`/`global`/`hybrid`/`mix`）。这取决于**索引建没建**，是一件运维事实，
 * 不是一个代码分支：建图是独立的长任务（约 $0.057/doc；说明书侧按
 * `lightrag-eval/results/mode-comparison.md` 的实测速率外推是数百小时量级），
 * 所以这个开关必须能跟着索引状态走，而不必重新发版。
 *
 * 背景：`mode-comparison.md` 结论 4 明确写着「`leaflet` 建图当前保持 off 是
 * "**待验证前的默认**"，不是"已验证的结论"」——所以这里的默认值是待验证状态下的
 * 选择，不是对图模式优劣的判定。
 *
 * 未知值**丢弃而不报错**：那是配置笔误，不是请求参数错误——请求参数的白名单校验
 * 在 `AssistantToolKnowledgeRetrievalService.parseMode`，两者不该混成同一个错误。
 * 返回空数组是合法结果，含义是"没有任何来源建了图"，即图模式全禁。
 *
 * 注意：没建图却放行图模式的后果**不是报错，是空结果**（图模式拿不到实体）。
 * 契约层会把原因如实写进 `coverage.reason`，但配置与索引状态应当保持一致。
 */
export function parseGraphSources(
  raw: string | undefined | null,
): LightragSource[] {
  if (raw == null) {
    return [];
  }
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is LightragSource =>
      (LIGHTRAG_SOURCES as readonly string[]).includes(part),
    );
}

/** 说明书 chunk 的来源字段（灌入时写入 metadata，查询侧用于溯源）。 */
export const LIGHTRAG_METADATA_LEAFLET_ID = 'leafletId';
export const LIGHTRAG_METADATA_SOURCE_FIELD = 'sourceField';

/**
 * 稳定 doc id 的前缀 —— 灌入侧（`scripts/import/medicine/rebuild-lightrag-index.ts`）
 * 与解析侧共用，改一处必须改另一处。
 *
 *   leaflet:<leafletId>:<sourceField>:<chunkIndex>
 *   qa:<qaId>:<chunkIndex>
 *
 * 前缀也标出了"这条命中该用什么身份溯源"：说明书有 leafletId + 字段名，
 * 问答只有 qaId。因此 `qa` 命中解析不出 leafletId **不是**溯源缺失，
 * 不该被标成 partial —— 见 `LightragChunk` 的字段说明。
 */
export const LIGHTRAG_DOC_ID_PREFIX_LEAFLET = 'leaflet';
export const LIGHTRAG_DOC_ID_PREFIX_QA = 'qa';

/** 一个检索命中的 chunk（已从 LightRAG 的 reference 形态归一）。 */
export interface LightragChunk {
  /** chunk 正文。 */
  text: string;
  /** 1-based 名次，与返回顺序一致。 */
  rank: number;
  /** LightRAG 未逐 chunk 给出分数，保留 null 以便将来有分时不改契约。 */
  score: number | null;
  /** 来源文档路径（LightRAG 的 `file_path`），也承载 Lucent 写入的稳定 doc id。 */
  filePath: string;
  /** 从 doc id 解析出的说明书 id；问答命中或无法解析时为 null。 */
  leafletId: string | null;
  /** 从 doc id 解析出的说明书字段名；问答命中或无法解析时为 null。 */
  sourceField: string | null;
  /** 从 doc id 解析出的问答条目 id；说明书命中或无法解析时为 null。 */
  qaId: string | null;
}

/** `POST /query`（`only_need_context=true`）的解构结果。 */
export interface LightragQueryOutcome {
  chunks: LightragChunk[];
  /**
   * 至少一条命中**本可溯源却解析不出身份**（doc id 既不是 `leaflet:` 也不是
   * `qa:` 形态）时为 true。
   *
   * 注意语义：`qa` 命中解析不出 `leafletId` 属于正常（它本来就没有说明书身份），
   * 不算未映射；只有连 qaId 都拿不到才算。
   */
  hasUnmappedChunk: boolean;
}

/** 调用失败时的判别式结果，避免用异常做控制流。 */
export type LightragCallFailureKind =
  | 'disabled'
  | 'timeout'
  | 'unreachable'
  | 'unauthorized'
  | 'bad_request'
  | 'server_error'
  | 'malformed_response';

export interface LightragCallFailure {
  kind: LightragCallFailureKind;
  /** 面向模型/运维的一句话原因（写进 envelope 的 coverage.reason）。 */
  reason: string;
  /** HTTP 状态码（网络层失败时为 null）。 */
  status: number | null;
}
