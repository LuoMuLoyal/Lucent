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
单一安全候选才返回详情，歧义返回 candidates）、`retrieval`（**中文散文检索**，见下节；
含 `LightragClientService` 与 `search_cn_medicine_knowledge`）、`records`
（档案/在服药品 + **餐食分析 digest `get_meal_analysis_digest`**）、`ontology`
（**英文侧 OAG 本体推理**，见下节；含 `SemanticaClientService`、
`OntologyCypherGeneratorService` 与 `reason_over_ontology`）、`proposal`
（`propose_create/update/delete_daily_record`、`propose_update_user_settings`，
只产出带 `expiresAt` 的提案，绝不直接写 DB）。
检索源强制分离：中文散文（说明书字段 / 医学问答）走 LightRAG；DrugBank
passage 走 Lucent 自己的 pgvector 表；`search_cn_medicine_products` /
`get_cn_medicine_detail` 走 SQL 键查——三者互不合并。DrugBank passage 检索
必须先 `resolve_drugbank_entity` 圈定实体范围。AI 分层（assistant=Agent，
其余默认 bounded-linear、复用 `common/llm`、copy 本地化）详见
`docs/explanation/architecture.md`。

### 中文散文检索（LightRAG，`tools/retrieval/`）

中文散文知识（说明书字段级语义检索 + 医学问答）的**导入与查询都交给 LightRAG
sidecar**，Lucent 只做参数校验与 envelope 归一：

- `LightragClientService` —— 纯 HTTP 客户端（`POST /query`，工作区经
  `LIGHTRAG-WORKSPACE` 头）。固定带 `only_need_context=true` +
  `include_chunk_content=true`，**绝不让 sidecar 生成答案**（否则是双重生成且绕开
  安全层）。失败（超时/4xx/5xx/不可达）返回判别式结果而非抛异常。
  客户端超时按模式分两档（`resolveTimeoutMs`）：`naive` 用
  `LIGHTRAG_TIMEOUT_MS`(8s)，图模式用 `LIGHTRAG_GRAPH_TIMEOUT_MS`(60s)——图模式实测
  16–29 秒，共用一个 8 秒预算会把它们全部打成超时。
- `AssistantToolKnowledgeRetrievalService` —— `search_cn_medicine_knowledge`
  （参数 `query` / `source` / `mode` / `limit`）。它是**唯一**知道哪些参数组合
  合法的地方：`source` 由模型给出但 **workspace 由服务端映射**；图模式
  （`local`/`global`/`hybrid`/`mix`）**只对已建图的来源开放**，白名单来自
  `LIGHTRAG_GRAPH_SOURCES`（默认 `leaflet`）；`bypass` 与未知 mode 直接拒绝；
  `verifiability` 按 `source` 服务端写入（`qa` = `open_corpus`，`leaflet` = `citable`）。
- **图模式的启用开关是运维事实，不是代码分支**：`LIGHTRAG_GRAPH_SOURCES` 表达的是
  "**这些来源的图已经建好了**"（建图是独立长任务，约 $0.057/doc、约 11.5 s/chunk ——
  后者是抽取侧换成便宜模型 + 关 thinking + 开 `MAX_ASYNC_LLM` 之后的实测值）。没建图却放行图模式的
  后果**不是报错，是空结果**——图模式拿不到实体。设成空串即回到"图模式全禁"。
  超时三层嵌套，改动时要一起看：客户端 60s < `RETRIEVAL_TOOL_EXECUTION_TIMEOUT_MS`
  65s < `ASSISTANT_NODE_TIMEOUT_MS`。依据见
  `lightrag-eval/results/mode-comparison.md`（line 132-134 与结论 5）。
- **服务不可用 ≠ 没有证据**：超时/5xx 写成
  `coverage.reason: '... retrieval is unavailable: ...'`，绝不静默降级成空结果。
  该状态同时经 `GET /capabilities` 暴露为
  `disabledReason: 'retrieval_unavailable'`（sidecar 未启用/不可达时
  `search_cn_medicine_knowledge` 报此原因；`search_drugbank_passages` 不受影响，
  它读的是 Lucent 自己的库）。
- **溯源**：命中带 `leafletId` / `sourceField`（`source=leaflet`）或 `qaId`
  （`source=qa`）；doc id 既非 `leaflet:` 也非 `qa:` 形态的命中标
  `coverage: partial`，不猜身份。`qa` 命中没有 `leafletId` 属正常，不算未映射。

### 中文散文的灌入（`scripts/import/medicine/rebuild-lightrag-index.ts`）

chunk 表是事实源，`pnpm import:lightrag --workspace=leaflet|qa` 把它推进
sidecar（`POST /documents/texts`），`file_sources` 写稳定 doc id：

```
leaflet:<leafletId>:<sourceField>:<chunkIndex>
qa:<qaId>:<chunkIndex>
```

段序是**跨进程契约**：改这里等于切断查询侧的溯源链。`--reset` 按 doc id
清空该 workspace 后再灌（幂等）。`leaflet` 与 `qa` 分属两个 workspace，
**在单实例上并未真正隔离**（上游 #2527：单实例仅支持单 workspace；实测
`LIGHTRAG-WORKSPACE` 头不改变实际读写位置），所以两者当前落在同一命名空间，
靠 doc id 前缀区分来源。

sidecar 的部署与独立配置（`deploy/lightrag/`、`LIGHTRAG_*` 变量）见
`docs/reference/environment-variables.md` 的 LightRAG 小节与
`docs/reference/deployment.md`。

### 英文侧 OAG 本体推理（Semantica，`tools/ontology/`）

英文 DrugBank 的结构化事实（药 → 靶点 / 酶 / 转运体、相互作用、ATC）以**确定性灌入**
建成 Apache AGE 图（零 LLM 抽取），`reason_over_ontology` 在这张图上做类型化多跳推理：

- **分工**：**NL→Cypher 的生成在 Lucent**（`OntologyCypherGeneratorService`，复用
  `AI_LANGUAGE_*` 角色），sidecar（`semantica-service`）只做**只读校验 + 执行**。
  因此 sidecar 不需要 LLM 凭据，`SEMANTICA_*` 里也没有密钥项——与 LightRAG 需要
  密钥握手不同。
- `SemanticaClientService` —— 纯 HTTP 客户端（`GET /schema`、`POST /query`）；把
  sidecar 的结构化 `detail.kind`（`not_read_only` / `syntax_error` /
  `unsupported_feature` / `timeout` …）归一出来，作为重试回路的判据。
- `AssistantToolOntologyReasoningService` —— `reason_over_ontology`（参数
  `question` / `limit`）。流程：读 schema → 生成 → 执行；被拒则**把 sidecar 的报错
  回喂模型重生成**（最多 3 次，总预算 30s）。重试回路是生产必需：实测模型会产出
  `OPTIONAL MATCH ... AS x` 这类非法语法，回喂报错即可自纠。
- **envelope 带可复核路径**：`cypher`（实际执行的查询）+ `citations`（每条断言一条
  PROV-O 引用）+ `sourceTier: 'drugbank_structured'`；**零行 = DrugBank 没有这条
  断言**，不是"查不到"；`truncated` 标 `coverage: partial`。**引用由 sidecar 解析**：
  图上每条边带 `prov` id（指回来源表与来源行），sidecar 把它解成来源表 / 行键 /
  原文 / 哈希链位置；行回来了却一条引用都没有时 `verifiability` 是 `'uncited'`
  （而不是 `'citable'`），并由工具**强制重写一次**要求返回 `r.prov`。SSE 把
  `citations` 与 `executedQuery` 一起投影给客户端（`toolDetails`），来源条可点击
  复制 id 去复核。生成侧与 prompt 侧的细节见 §"生成侧的硬约束"。
- **图节点超时必须高于工具预算**：`ASSISTANT_NODE_TIMEOUT_MS` = 模型超时 + 一次
  工具预算（默认 60s）。原先节点默认取 `AI_MODEL_TIMEOUT_MS`（10s），比
  `reason_over_ontology` 自己的 45s 预算还小——实测表现是慢查询被节点超时掐断、
  LangGraph 重试三次，客户端只拿到每次尝试的半截答案，最后以
  `Node "agent" exceeded its run timeout` 结束。
- **与中文散文检索各自独立判定**：`ASSISTANT_OAG_TOOL_NAMES` 与
  `ASSISTANT_RETRIEVAL_TOOL_NAMES` 分开，一个 sidecar 挂掉不会把另一个的工具标成
  不可用；两者都报 `disabledReason: 'retrieval_unavailable'`（客户端渲染同一个
  "来源暂不可用"，具体是哪个由工具 envelope 说清）。
- **生成侧的硬约束写在 prompt 里**：AGE 1.7 无 `shortestPath` / 多类型边 /
  `datetime()`；必须显式 `LIMIT`；值走 `params`；**名称必须 `toLower()` 匹配**
  —— 图上名称按 DrugBank 原样大写，精确匹配会静默返回 0 行，而那会被说成
  "DrugBank 没有这条断言"（看起来像答案的错答案）。真正的强制在 sidecar 的守卫。
  另外三条来自实测（2026-09-19 走 API 的验证）：**关系必须返回 `prov`**；
  **多跳的角色链各有各的关系类型**（"抑制那个代谢 X 的酶"是
  `(X)-[:SUBSTRATE_OF]->(e:Protein)<-[:INHIBITS]-(i:Drug)`，两侧用同一个类型会
  返回 0 行）；**酶按基因名问、ATC 按 code 问**（"CYP3A4" 存在 `gene_name` 上，
  而 ATCClass 节点只有 `code`、没有名称）。
- 部署与变量（`deploy/semantica/`、`SEMANTICA_*`）见
  `docs/reference/environment-variables.md` 的 Semantica 小节。sidecar 尚无镜像，
  dev 走本机 `uvicorn`，容器化部署未完成。
- **不接它的生成能力、Rete / SPARQL / 时态推理 / 决策智能**：答案出口唯一
  （ADR-0021）。它自带的四类生成（答案 / 查询 / 本体候选 / 实体关系抽取）都不用，
  "解释"也不走 `ExplanationGenerator`（它吃不了 Datalog 的字符串输出）——我们自己的
  "规则名 + 前提引用"就是解释。Rete 需要 `Rule` 对象而非 Datalog 文本且没有
  fixpoint；SPARQL 需要三元组库（Oxigraph 在本仓只是 extra）；时态与决策记录没有
  产品场景。
- **不引入它的嵌入 / NER / 消解 / 文档解析链路**：英文侧走确定性灌入，用不到。
- **不把推理结论写成诊断或用药建议**：结论只作为"待复核的潜在关系"呈现
  （`verifiability: 'derived'`），不进入任何自动建议。

### 工具参数（模型定窗）

工具调用参数经 `AssistantToolCall` 从 `agent` 节点一路带到执行层
（`AssistantToolExecutionContext.toolArgs`），**不再**从 `userMessage` 文本猜
参数。带参数的工具目前有三个：`get_meal_analysis_digest`（`days` / `limit`）、
`search_cn_medicine_knowledge`（`query` / `source` / `mode` / `limit`）与
`reason_over_ontology`（`question` / `limit`）。以 `get_meal_analysis_digest` 为例：`days` / `limit`
由模型给出，服务端封顶最近 `15` 天、最多 `20` 餐（封顶写进 envelope 的
`ambiguities` + `coverage: partial`）；它读餐食投影列判定 `analyzed` 并取
headline/区间，只为返回的 ≤`limit` 条回读 `payload.mealAnalysis` 取
`items` / `dishes`，从而**不再重复识图**。无参数工具的参数 schema 仍是空对象。

## Persistence & Memory

`repositories/`：conversation/memory/summary 三仓 + `AssistantCheckpointerService`
（Postgres checkpointer）。跨对话记忆由归档对话后台去抖抽取，注入上限 5 条；
删除对话不删除记忆，`DELETE memory` 是设置页全量清除入口。assistant 对话与
历史 Today/Report AI 摘要是两回事。

## Dependencies

Imports：Auth、LlmCommon、LlmRuntime、Medicines、UserSettings、
UserHealthContext、DailyRecords、MedicineReminders。Port DI（ADR-0009）：
`MEDICINE_REMINDER_READER`、`DAILY_RECORD_READER`、
`DAILY_RECORD_CANDIDATE_GENERATOR`，以及类令牌 `DailyRecordReaderPort`
（餐食 digest 的范围读）。Barrel 仅导出
`HistoricalAiSummaryService`（reports 消费）。

## Tests

`assistant.controller.spec.ts`、`services/core.service.spec.ts`、
`agent/runtime/*.spec.ts`（classify/graph/nodes/respond/review/router/
validate/model-stream 等 + `subgraphs/*.spec.ts`）、`tools/**/*.spec.ts`
（含 `retrieval/lightrag-client.service.spec.ts` 与
`retrieval/knowledge.service.spec.ts`：成功/超时/4xx/5xx/未配置/qa 选 mix 被拒/
leaflet 评测前选 mix 被拒/空结果/溯源缺失标 partial）、
`repositories/conversation.repository.spec.ts`、`services/policy.service.spec.ts`。
