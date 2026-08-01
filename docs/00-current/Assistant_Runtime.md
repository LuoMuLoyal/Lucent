# Assistant Runtime

Last updated: 2026-08-01

- LangGraph orchestration upgraded to a 4-branch intent-routed graph: `classify_intent`
  dispatches `simple_chat -> respond`, `read_data -> read_subgraph`, `write_proposal ->
write_subgraph`, `knowledge -> knowledge_subgraph`, and unknown/mixed intents fall through to
  the full `agent <-> tools` loop (`agent` is bound to the intent-filtered relevant tool set).
- Graph-level defaults are set once via `setNodeDefaults`: `retryPolicy` (explicit
  `isRetryableLlmError` whitelist, `maxAttempts: 3`), `timeout: AI_MODEL_TIMEOUT_MS`, and
  `cachePolicy: false` as the node default; opt-in nodes override per-node.
- Caching is applied at three layers: (1) node cache for deterministic `classify_intent` via
  `InMemoryCache` + `compile({ cache })` with a 1h TTL; (2) tool cache for knowledge tools
  (`KNOWLEDGE_TOOL_NAMES`) via cache-manager keyed on tool+query+filters with a 1h TTL; (3)
  response cache for cacheable simple-chat turns (no memory injected, no tool results) via
  cache-manager keyed on locale + user-message hash with a 1h TTL. Cache hits are counted in
  `assistant_cache_accesses_total{kind,hit}` metrics.
- Read/write/knowledge subgraphs each end in a validation node: `read_validate` /
  `write_validate` / `knowledge_validate` emit `stopReason` (`no_data` / `no_target` /
  `no_evidence`) and append a SystemMessage with guidance to the conversation when coverage is
  partial/empty or no proposal/evidence was produced, instead of looping back.
- Memory injection now lives in `prepare_context`: when `memoryEnabled` and a new conversation,
  the user's memory block is prepended as a HumanMessage and `memoryInjected` is set, which also
  excludes the turn from the response cache.
- Assistant retrieval is source-split across Chinese leaflet RAG, assistant-only filtered medical
  QA, and entity-scoped DrugBank scientific retrieval.
- Assistant runtime now carries bounded retrieval-loop state (`loopCount`, `selectedTools`,
  `stopReason`) and keeps tool use server-owned.
- Assistant tool surface now also includes structured Chinese product search/detail
  (`search_cn_medicine_products`, `get_cn_medicine_detail`) and structured DrugBank detail reads
  (`get_drugbank_detail`) in addition to the retrieval-only tools.
- Explicit CN product-style assistant questions now prefer a source-owned CN chain:
  `search_cn_medicine_products` -> `get_cn_medicine_detail` -> `search_medicine_leaflets` for
  leaflet-style follow-up questions, instead of pulling DrugBank or medical-QA retrieval into the
  same first-pass plan.
- Assistant retrieval misses do not fall back to keyword guessing once a vector-backed retrieval
  path is selected.
- Medical QA retrieval remains assistant-only reference material and is not a frontend linear
  medication-flow evidence source.
- `search_medicine_leaflets` now resolves a product by aggregating vector chunk scores over
  `leaflet_embeddings` before retrieving chunks, and returns the resolved product in
  `result.resolvedProduct`. It still returns vector-page metadata (`limit`, `offset`, `hasMore`,
  `nextCursor`) and supports metadata-filtered retrieval without switching back to SQL keyword
  fallback.
- Assistant tool execution now carries resolved CN `productId` forward into downstream leaflet
  retrieval by rewriting the leaflet tool payload with `filters.productId` when one structured CN
  detail record was already resolved safely.
- Today analysis now produces two notification types in addition to persisting
  `assistant_summary_histories`: `ai_today_summary` and `ai_proactive_suggestion`. Both carry
  `actionPayload.date` and `actionPayload.source=today-analysis` for frontend attribution.
- When today analysis is regenerated on the same day, the two notification types are overwritten
  by `type + source + date` scoped replace, cleaning up old duplicates to avoid polluting the
  notification page and report page suggestion history.
- Tool keyword matching rules (`TOOL_KEYWORD_RULES`, `BROAD_*_RULES`, `WRITE_INTENT_RULES`,
  `EXPLICIT_CN_PRODUCT_RULES`, `CN_LEAFLET_STYLE_RULES`) have been extracted from `router.ts`
  into `agent/runtime/tool-keyword-rules.ts`. `router.ts` now contains only the two routing
  functions (`selectAllowedToolsForContextSources`, `selectRelevantToolsForMessage`).
- Proposal draft extraction logic (`extractRecordUpdateDraft`, `extractSettingsDraft`) has been
  extracted from `proposal.service.ts` into `tools/proposal-draft-extractor.ts` as pure functions.
- `extractSettingsDraft` and `applyContextToggle` now respect negation semantics: when a toggle
  keyword (关闭/disable/turn off/打开/enable/turn on) is preceded by a negation word
  (不要/别/不用/无需/不/don't/do not/never), the match is skipped and no setting is changed.

## Checkpoint 持久化 + 图内审批（HITL）

- 会话线程持久化：`AssistantCheckpointerService`（进程级单例）用 `DATABASE_URL` 建 `pg.Pool`
  并包装 `PostgresSaver`（`setup()` 幂等建表）；`DATABASE_URL` 缺失或初始化失败时
  `getSaver()` 返回 `null`，调用方降级为无 checkpoint 的旧行为；`onModuleDestroy` 释放 pool。
- `thread_id = conversationId`：`StreamAssistantMessagesDto` 新增可选 `conversationId`（thread id），
  仅在 `conversationId` 与 checkpointer 同时就绪时以 `{ configurable: { thread_id } }` 编译并
  invoke 图；缺省保持无状态执行。
- 图内 interrupt 审批：write 分支在 checkpointer 可用时插入两段式节点
  `write_review_setup`（提取 proposalIds/expiresAt，写 `pendingReview(status='pending')` +
  `stopReason='awaiting_review'`）→ `write_review`（`interrupt` 挂起线程）；无提案
  （`no_target`）直连 `respond`；无 checkpointer 时不挂 review 节点（旧行为）。
- 确认端点：`POST assistant/conversations/:conversationId/confirm`
  （`ConfirmAssistantProposalDto`：proposalIds/decision/note）。服务端经
  `core.service.confirmProposal` → `runtime.service.resumeConversation`：校验会话归属、
  `getState` 中 `pendingReview.status==='pending'` 与 `expiresAt` 未过期，再以
  `Command({ resume: { decision, note } })` 恢复线程；批准/拒绝决定写回 `pendingReview`
  并追加 SystemMessage 指引（approved 仍需客户端执行真实写入，rejected 禁止声称写入）。
- 降级矩阵：无 `conversationId` → 不传 thread_id、不 interrupt；checkpointer 为 null →
  不插 review 节点；提案过期 / confirm 重复 / 未知线程 → `badRequest`。
