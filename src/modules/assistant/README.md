---
status: active
owner: backend
---

# assistant

基于 LangGraph 的多意图路由 AI 助手：SSE 流式对话、健康数据读取、药品知识
检索（RAG）、日报/设置写入提案（HITL 确认）、跨对话记忆与对话持久化。
历史契约细节见 `docs/archive/01-reference/contracts/assistant-contract.md` 与 `assistant-capabilities.md`。

## Endpoints（挂 `/user` 前缀，事实源 = openapi.json）

- `GET capabilities` — 能力/权限发现：settings 门禁 + 服务端状态合成
  `AssistantToolCapabilityDto[]`（`permittedByUser`/`enabled`/`disabledReason`）、
  `langGraphReady`/`streamingTransport: 'sse'`/`markdownRenderingRecommended`。
- `GET conversations` / `GET latest` / `POST conversations/:id/open` —
  最近列表 / 最新活跃对话（可为 null）/ 激活选中对话并归档旧活跃对话。
- `POST latest/clear`（归档而非删除）、`PATCH conversations/:id`（重命名，
  title 非空 ≤48 字符）、`DELETE conversations/:id`（软删除，已删即 404）、
  `DELETE memory`（幂等清空全部跨对话记忆，返回 `{ cleared }`）。
- `POST messages/stream` — SSE 主入口：`chunk`→`result`→`done`，失败为
  `error` 事件（Problem Details 字段）；body 带 `conversationId` 则走
  checkpoint 持久线程，否则无状态。
- `POST conversations/:id/confirm` — 批准/拒绝挂起的写入提案并恢复线程；
  重复确认/过期 review 被拒。批准时服务端原子应用写入。
- `POST conversations/:id/regenerate` — LangGraph 时间旅行重放 `respond`
  节点重答最后一条 assistant 消息；仅最后一条可再生成，30 秒内重复 409，
  旧答案保留为 revision，结果 `usedTools`/`toolDetails` 为空。

## Runtime Graph（`agent/runtime/`）

`prepare_context`（system prompt + 记忆 + allowed tools）→ `classify_intent`
（纯规则关键词路由，无 LLM）→ 5 种 intent：`simple_chat` 直达 `respond`、
`read_data`/`write_proposal`/`knowledge` 走子图、`mixed` 走 `agent↔tools`
循环 → `write_review`（HITL 暂停，等 confirm，依赖 checkpointer）→
`respond` 流式输出。工具循环与检索次数受服务端上限约束（bounded）。

## Tools（`tools/`，按域分目录）

`read`（日报记录查询 + today/report/sleep 摘要读取，范围上限 14 天，统一 envelope：
query/coverage/confidence/ambiguities）、`medicine`+`drugbank`（结构化查询，
单一安全候选才返回详情，歧义返回 candidates）、`leaflet`（中文说明书向量
检索，miss 不回退关键词猜测）、`knowledge`（医学问答语料：assistant-only，
开放语料统一 `verifiability: 'open_corpus'` 低可信标注，每页上限
`MEDICAL_QA_MAX_LIMIT = 5`，前端线性服药流程不得消费）、`records`
（档案/在服药品）、`proposal`（`propose_create/update/delete_daily_record`、
`propose_update_user_settings`，只产出带 `expiresAt` 的提案，绝不直接写 DB）。
检索源强制分离：中文说明书、DrugBank passage、医学问答各用独立向量表与
工具，互不合并；DrugBank passage 检索必须先 `resolve_drugbank_entity` 圈定
实体范围。AI 分层（assistant=Agent，其余默认 bounded-linear、复用
`common/llm`、copy 本地化）详见 `docs/explanation/architecture.md`。

## Persistence & Memory

`repositories/`：conversation/memory/summary 三仓 + `AssistantCheckpointerService`
（Postgres checkpointer）。跨对话记忆由归档对话后台去抖抽取，注入上限 5 条；
删除对话不删除记忆，`DELETE memory` 是设置页全量清除入口。assistant 对话与
历史 Today/Report AI 摘要是两回事。

## Dependencies

Imports：Auth、LlmCommon、LlmRuntime、Medicines、UserSettings、
UserHealthContext、DailyRecords、MedicineReminders。Port DI（ADR-0009）：
`MEDICINE_REMINDER_READER`、`DAILY_RECORD_READER`、
`DAILY_RECORD_CANDIDATE_GENERATOR`。Barrel 仅导出
`HistoricalAiSummaryService`（reports 消费）。

## Tests

`assistant.controller.spec.ts`、`services/core.service.spec.ts`、
`agent/runtime/*.spec.ts`（classify/graph/nodes/respond/review/router/
validate/model-stream 等 + `subgraphs/*.spec.ts`）、`tools/**/*.spec.ts`、
`repositories/conversation.repository.spec.ts`、`services/policy.service.spec.ts`。
