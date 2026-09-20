/**
 * Sidecar client defaults, shared by the zod env schema and the clients.
 *
 * These values used to be written twice — once as `.default(...)` in
 * `environment.validation.ts` and once as a private `FALLBACK_*` constant in the
 * client. Two copies of one fact drift: changing the port in the schema would
 * leave the fallback (which is exactly what a test constructing `ConfigService`
 * directly, or an unvalidated path, actually uses) pointing at the old one.
 *
 * They live here rather than in the schema because the schema is not the only
 * reader, and here rather than in `EnvKey` because that enum is about names,
 * not values.
 */

/** Default LightRAG sidecar base URL (compose service name). */
export const LIGHTRAG_DEFAULT_BASE_URL = 'http://lightrag:9621';

/** Default LightRAG request timeout: shorter than the tool budget on purpose. */
export const LIGHTRAG_DEFAULT_TIMEOUT_MS = 8000;

/**
 * Default LightRAG request timeout for **graph** retrieval modes
 * (`local` / `global` / `hybrid` / `mix`).
 *
 * 图模式每次查询都要现调 LLM 做关键词抽取、再遍历图，实测 16–29 秒；`naive` 是 352ms。
 * 用 8 秒的默认超时会把**所有**图模式查询打成超时失败，所以图模式单独用一个预算
 * （`lightrag-eval/results/mode-comparison.md` line 132-134 就是这么写的）。
 *
 * 与工具级超时的关系：这个值必须**小于** `RETRIEVAL_TOOL_EXECUTION_TIMEOUT_MS`，
 * 超时原因才会由客户端说清楚（"检索超时"），而不是落到工具层那句笼统的
 * "Tool execution timed out."。
 */
export const LIGHTRAG_GRAPH_DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 默认"已经建好知识图谱"的来源（`LIGHTRAG_GRAPH_SOURCES` 的默认值）。
 *
 * `qa` 刻意不在其中：全量抽取的墙钟成本在数千小时量级
 * （`mode-comparison.md` 结论 6：建图单价约 $0.057/doc）。
 */
export const LIGHTRAG_DEFAULT_GRAPH_SOURCES = 'leaflet';

/** Default Semantica sidecar base URL (compose service name). */
export const SEMANTICA_DEFAULT_BASE_URL = 'http://semantica:8099';

/**
 * Default Semantica request timeout.
 *
 * Must exceed the sidecar's own `statement_timeout` (15s by default), otherwise
 * the client cuts the call before the server can report a structured timeout.
 */
export const SEMANTICA_DEFAULT_TIMEOUT_MS = 20000;
