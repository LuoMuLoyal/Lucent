/**
 * LightRAG sidecar 的客户端契约（类型 + 常量）。
 *
 * 这一层只描述"Lucent 怎么调 LightRAG"，不描述 LightRAG 自己的存储/模型配置
 * —— 后者只存在于 sidecar 的独立 env 文件里（见 `deploy/lightrag/`）。
 *
 * 上游事实源（2026-09 核对 HKUDS/LightRAG main 分支）：
 * - `POST /query` → `{ response, references: [{ reference_id, file_path, content? }] }`，
 *   `content` 仅在 `include_chunk_content=true` 时出现；
 * - `POST /documents/texts` → `{ texts: string[], file_sources?: string[] }`；
 * - `POST /documents/delete_document` → `{ doc_ids: string[] }`；
 * - `GET /health`；
 * - workspace 经 `LIGHTRAG-WORKSPACE` 头选择；鉴权经 Bearer token。
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

/** Lucent 侧允许模型选择的检索来源（服务端映射到 workspace，模型不能直接指定 workspace 名）。 */
export const LIGHTRAG_SOURCES = ['leaflet', 'qa'] as const;

export type LightragSource = (typeof LIGHTRAG_SOURCES)[number];

/** 默认检索模式：纯 chunk 向量检索，不碰图（计划 §一.3）。 */
export const LIGHTRAG_DEFAULT_MODE: LightragQueryMode = 'naive';

/** 默认 / 最大返回条数（计划 §5.2）。 */
export const LIGHTRAG_DEFAULT_LIMIT = 4;
export const LIGHTRAG_MAX_LIMIT = 8;

/**
 * 未通过建图评测前只开放 `naive` 的来源。
 *
 * `qa` 永远不建图（全量抽取的墙钟成本在数千小时量级），`leaflet` 在 P2 评测
 * 证明图模式有收益前也不建图——没建图时 `local/global/mix` 拿不到实体、下场是空
 * 结果，不如直接拒绝并给出 reason。
 */
export const LIGHTRAG_SOURCES_WITHOUT_GRAPH: readonly LightragSource[] = [
  'leaflet',
  'qa',
];

/** 说明书 chunk 的来源字段（灌入时写入 metadata，查询侧用于溯源）。 */
export const LIGHTRAG_METADATA_LEAFLET_ID = 'leafletId';
export const LIGHTRAG_METADATA_SOURCE_FIELD = 'sourceField';

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
  /** 从 doc id / metadata 解析出的说明书 id；无法解析时为 null。 */
  leafletId: string | null;
  /** 从 doc id / metadata 解析出的说明书字段名；无法解析时为 null。 */
  sourceField: string | null;
}

/** `POST /query`（`only_need_context=true`）的解构结果。 */
export interface LightragQueryOutcome {
  chunks: LightragChunk[];
  /** 至少一条命中无法映射回 `leafletId`（可能是别处灌入的文档）时为 true。 */
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
