---
status: active
owner: backend
---

# assistant

基于 LangGraph 的多意图路由 AI 助手：SSE 流式对话、健康数据读取、药品知识
检索（RAG）、日报/设置写入提案（HITL 确认）、跨对话记忆与对话持久化。
历史契约细节见 `docs/archive/01-reference/contracts/assistant-contract.md` 与 `assistant-capabilities.md`。

## 限界上下文（ADR-0024）

本模块承载 **AI Assistant** 上下文（上下文名 `assistant`）。按 ADR-0024
的聚合边界：

- 聚合根：`Conversation`（含有序消息，顺序单调）、`Memory`（每用户一份，
  清空幂等）、`Proposal`（pending 才可确认，确认恰好一次）、`Summary`
  （按对话版本保存，不反向修改消息）。
- 提案的目标动作（`ProposedAction`）经 command/proposal 契约写入目标上下文，
  不直接操作他上下文表。
- 领域事件（计划）：`proposal_confirmed`、`conversation_archived` 等，
  经 outbox 发布。

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

## Runtime Graph（`adapters/agent/`）

单一 ReAct 循环：`prepare_context`（写提示词与用户消息）→ `agent ⇄ tools`
（模型自己决定调什么、调几次）→ `validate`（判空覆盖/缺提案/触顶）→
`respond`（流式输出）；有 checkpointer 且本轮产出了提案时，`validate` 之后
插入 `write_review_setup → write_review`（HITL 暂停，等 confirm）。

```text
START → prepare_context → agent ⇄ tools → validate → respond → END
                                      └→ capped →↗        └→ write_review_* (HITL)
```

### 为什么没有路由层与子图

曾经有 `classify_intent`（一次模型调用）选出工具子集，再投影成 `intent`，再切进
固定子图。三个后果都是生产实测的：

1. 路由只看当前那条消息 → 「那你查一下」绑不到任何工具（回答里什么工具都没有）。
2. 子图是硬边界：读记录的途中发现要查药品，**同一个 turn 里出不去**。
3. 工具选择本来就是 function calling 在做的事。多花一次模型调用去预先决定，
   再把结果当硬约束，是为同一个决定付两次钱。

### 关键契约

- **候选集是硬上限**：由 `policy.enabledToolNames` 算好传入 —— 用户 context 开关 ∩
  已实现 ∩ **sidecar 可用**。`agent` 绑定它**全量**，不再二次筛选。
- **循环上限可配**：运行时键 `ASSISTANT_MAX_TOOL_LOOPS`（基线 8）。触顶记
  `stopReason: 'tool_cap_reached'`，由 `validate` 的 `capped` 节点显式记录 ——
  `tools` 每次迭代都会清空 `pendingToolCalls`，不另立标志位就分不清「自然结束」
  与「被截断」，回复会把半截调查说成完整结论。
- **`stopReason` 由 `validate` 决定，`respond` 不覆盖**。`respond` 只在没有上游
  判定时回落到 `answered`；否则它会盖掉 `tool_cap_reached` 与 `no_evidence`。
- **`agent` 收到空文本视为未作答**（`finalContent: null`），不是「回答为空串」：
  后者会让 `respond` 直接抛错，而实际发生的是模型停下来了，`respond` 仍可作答。
- **提示词只有一份**（`application/services/prompts.ts`）。工具清单是唯一变量，
  按 DSH 的 `tool-design` 规则写：每条事实只说一次，参数规则留在参数上。
- **响应缓存**覆盖「本轮无工具、无记忆注入」的回复，命中点在 `respond`（agent 直答
  与 respond 自答两条路径都会写）。

### deepagents 运行时（灰度开关，默认仍走 graph）

`buildAssistantDeepAgent` 用 `createDeepAgent` 装配同一拓扑，额外拿到规划
（`write_todos`）、文件系统、shell 与 `task` 子智能体委派。**接线方式是灰度开关**
`ASSISTANT_AGENT_RUNTIME`（默认 `graph`）：`runtime.ts` 按轮读取，`deepagents` 值经
`deep-agent-runner.ts` 把运行输出映射为与 graph 相同的 `AssistantConversationResult`
（`streamedContent` 恒为 `false`，最终文本由 `streamPreGeneratedContent` 切块下发，
SSE 契约不变）。两条语义边界：含 `*_draft` 工具的轮次**无条件走 graph**（deepagents
路径不挂 checkpointer，其 `interruptOn` 不可用，提案必须留给 graph 的 interrupt）；
deepagents 运行失败该轮自动回落 graph。`general-purpose` 兜底子智能体由 deepagents
自动注入；agent 内的委派由模型读 subagent description 自行决定，不加外部路由。

三个组成部分：

- `tool-bridge.ts` —— 把 24 个既有工具包成 `StructuredTool`，实现**调用既有
  `executeMany`**。参数 schema 用 zod 手写（只有 6 个工具带参数），上界读同一份
  运行时预算，模型看到的范围与服务端夹紧一致。不要在这里重写执行逻辑：提案信封
  与超时契约都在原执行器里，第二份执行器必然漂移。
- `subagents.ts` —— `knowledge` / `records` / `analyst` 三个子智能体，**按上下文
  形态分而不是按工具分**（长散文 / 多行结构化记录 / 文件与命令）。它们**不声明
  `tools`**，继承父级工具集：隔离的是上下文窗口，不是能力。
- `workspace.ts` —— 每会话一个临时目录 + 清洗过的环境变量。

### 关于 shell：没有沙箱

`LocalShellBackend` 的原文是「Commands are executed directly on the host system
without any sandboxing, process isolation, or security restrictions」，它自己把
「Production environments (e.g., web servers, APIs, multi-tenant...)」列为不适用
场景。当前实现**直接使用它**，这是本阶段的明确取舍，不是遗漏。

`workspace.ts` 仍然做两件事，因为它们零成本且消除了两个不需要攻击者就会发生的
失败：**独立 cwd**（否则 `pwd` 是仓库根，`.env.development` 与源码都在那儿）与
**环境变量清洗**（`/KEY|PASSWORD|SECRET|TOKEN|CREDENTIAL|URL|DSN|CONN/i` 与
`DSH_*`）。`virtualMode: true` 只约束**文件工具**，不约束 shell 命令——两道理应分开。

**因此：能读到 `~/.ssh` 或 `env` 的 agent，也能被任何影响其提示词的东西驱动。**
真正隔离需要每会话一个容器，那是独立改动；本模块不应长出半套「看起来像防护」的围栏。

## MCP 端点（`adapters/mcp/`，`/api/v1/mcp`）

把**知识检索组**暴露为 MCP server，传输是 **Streamable HTTP**（不是已废弃的
HTTP+SSE，也不做 stdio）。协议实现走官方 SDK，规范依据
[MCP 2025-06-18 · Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)。

### 为什么不提供 stdio

stdio 由客户端拉起子进程，而工具执行需要 Nest DI（Prisma、Redis、sidecar 客户端、
指标）。子进程里没有容器，等于把整个依赖图重造一遍；从 HTTP 边界进来，DI 现成。

### 分层

| 层                   | 文件             | 职责                                                      |
| -------------------- | ---------------- | --------------------------------------------------------- |
| `domain/mcp/`        | `exposure.ts`    | 导出哪些工具、命名契约。**不 import 框架**                |
| `application/ports/` | `mcp.ts`         | 执行端口 + 调用方身份                                     |
| `adapters/mcp/`      | `server.ts`      | 会话表、`StreamableHTTPServerTransport`、Origin、错误映射 |
|                      | `routes.ts`      | Fastify 路由（`reply.hijack()` 让 transport 接管响应流）  |
|                      | `tool-schema.ts` | JSON Schema → zod（给 SDK 校验入参）                      |
|                      | `execution.ts`   | 端口 → 既有 `executeMany` 的薄适配                        |
|                      | `auth.ts`        | bearer 鉴权（常量时间比较）                               |
|                      | `mcp.module.ts`  | Nest 装配 + 路由注册（`onModuleInit`）                    |

### 关键契约

- **暴露范围是领域决策，不是过滤器**。手写 8 个知识检索工具，**不**导出用户私有
  数据（`get_records_*` 等）与写入提案（`*_draft`，离开 confirm 端点会把状态机劈成
  两半）。`exposure.spec.ts` 断言这些工具的 `requiredSources` 全为空——这是「MCP 只
  认证服务、不认证带数据的用户」成立的前提。
- **工具名即线上名，无前缀**：`TOOL_NAMES` 怎么拼就怎么上线。命名空间冲突由**客户端**
  解决——挂多个 server 的代理才加前缀，是为了让任何 server 都无法抢占别的 server 的
  名字；server 自己加前缀只会在已经加前缀的客户端上变成双重前缀。名字的稳定性由服务端
  负责：只有工具真正增删时才变，永不随配置变。
- **执行必须走既有 `executeMany`**：提案信封、单工具超时、缓存、指标都在里面。
  第二份执行器必然漂移，漂移的表现是「提案被描述成已执行的写入」。
- **工具失败回 `isError: true` 的结果**，不是协议错误：规范区分「调用完成且答案是
  错误」与「协议失败」，客户端能对前者做出反应。
- **安全三条是强制项**：校验 `Origin`（无 `Origin` 放行，CLI 不发这个头）、只绑
  回环（部署侧决定）、所有连接鉴权。`MCP_API_KEY` 未设置时启动打 `warn`。

### 测试

`exposure.spec.ts`（导出名单、命名纯函数、越权拒绝）、`tool-schema.spec.ts`
（区间/必填/枚举校验真的生效）、`auth.spec.ts`（token 比较、未配置时的行为）、
`server.spec.ts`（**真 Fastify + 真 SDK client 端到端**：tools/list、tools/call、
参数透传、失败映射、401、403、无 Origin 放行）。

## Tools（`adapters/acl/tools/`，按域分目录）

`read`（日报记录查询 + today/report/sleep 摘要读取，范围上限 14 天，统一 envelope：
query/coverage/confidence/ambiguities）、`medicine`+`drugbank`（结构化查询，
单一安全候选才返回详情，歧义返回 candidates）、`retrieval`（**中文散文检索**，见下节；
含 `LightragClientService` 与 `search_cn_knowledge`）、`records`
（档案/在服药品 + **餐食分析 digest `get_meal_digest`**）、`ontology`
（**英文侧 OAG 本体推理**，见下节；含 `SemanticaClientService`、
`OntologyCypherGeneratorService` 与 `reason_ontology` / `reason_rules`）、`proposal`
（`create/update/delete_record_draft`、`update_settings_draft`，
只产出带 `expiresAt` 的提案，绝不直接写 DB）。
检索源强制分离：中文散文（说明书字段 / 医学问答）走 LightRAG；DrugBank
passage 走 Lucent 自己的 pgvector 表；`search_cn_products` /
`get_cn_product_detail` 走 SQL 键查——三者互不合并。DrugBank passage 检索
必须先 `resolve_drugbank` 圈定实体范围。AI 分层（assistant=Agent，
其余默认 bounded-linear、复用 `common/llm`、copy 本地化）详见
`docs/explanation/architecture.md`。

### 中文散文检索（LightRAG，`adapters/acl/tools/retrieval/`）

中文散文知识（说明书字段级语义检索 + 医学问答）的**导入与查询都交给 LightRAG
sidecar**，Lucent 只做参数校验与 envelope 归一：

- `LightragClientService` —— 纯 HTTP 客户端（`POST /query`，工作区经
  `LIGHTRAG-WORKSPACE` 头）。固定带 `only_need_context=true` +
  `include_chunk_content=true`，**绝不让 sidecar 生成答案**（否则是双重生成且绕开
  安全层）。失败（超时/4xx/5xx/不可达）返回判别式结果而非抛异常。
  客户端超时按模式分两档（`resolveTimeoutMs`）：`naive` 用
  `LIGHTRAG_TIMEOUT_MS`(8s)，图模式用 `LIGHTRAG_GRAPH_TIMEOUT_MS`(60s)——图模式实测
  16–29 秒，共用一个 8 秒预算会把它们全部打成超时。
- `AssistantToolKnowledgeRetrievalService` —— `search_cn_knowledge`
  （参数 `query` / `source` / `mode` / `limit`）。它是**唯一**知道哪些参数组合
  合法的地方：`source` 由模型给出但 **workspace 由服务端映射**；图模式
  （`local`/`global`/`hybrid`/`mix`）**只对已建图的来源开放**，白名单来自
  `LIGHTRAG_GRAPH_SOURCES`（默认 `leaflet`）；`bypass` 与未知 mode 直接拒绝；
  `verifiability` 按 `source` 服务端写入（`qa` = `open_corpus`，`leaflet` = `citable`）。
  参数 schema 的 `limit` 上界与执行侧夹紧读同一份运行时快照（`LIGHTRAG_MAX_LIMIT`），
  每次构建工具定义时重算。
- **图模式的启用开关是运维事实，不是代码分支**：`LIGHTRAG_GRAPH_SOURCES` 表达的是
  "**这些来源的图已经建好了**"（建图是独立长任务，约 $0.057/doc、约 11.5 s/chunk ——
  后者是抽取侧换成便宜模型 + 关 thinking + 开 `MAX_ASYNC_LLM` 之后的实测值）。没建图却放行图模式的
  后果**不是报错，是空结果**——图模式拿不到实体。设成空串即回到"图模式全禁"。
  超时三层嵌套，改动时要一起看：客户端 60s < `RETRIEVAL_TOOL_EXECUTION_TIMEOUT_MS`
  65s < `ASSISTANT_NODE_TIMEOUT_MS`。依据来自工作区根目录
  `lightrag-eval/results/mode-comparison.md`（line 132-134 与结论 5，
  Lucent 仓外资料）。
- **服务不可用 ≠ 没有证据**：超时/5xx 写成
  `coverage.reason: '... retrieval is unavailable: ...'`，绝不静默降级成空结果。
  该状态同时经 `GET /capabilities` 暴露为
  `disabledReason: 'retrieval_unavailable'`（sidecar 未启用/不可达时
  `search_cn_knowledge` 报此原因；`search_drugbank` 不受影响，
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

### 英文侧 OAG 本体推理（Semantica，`adapters/acl/tools/ontology/`）

英文 DrugBank 的结构化事实（药 → 靶点 / 酶 / 转运体、相互作用、ATC）以**确定性灌入**
建成 Neo4j 图（零 LLM 抽取），`reason_ontology` 在这张图上做类型化多跳推理：

- **分工**：**NL→Cypher 的生成在 Lucent**（`OntologyCypherGeneratorService`，复用
  `AI_LANGUAGE_*` 角色），sidecar（`semantica-service`）只做**只读校验 + 执行**。因此
  sidecar 不持有 LLM 凭据；取而代之的是一条**共享 bearer token**：
  `SemanticaClientService` 对每个请求（含 `GET /schema`，sidecar 把鉴权挂在路由级）
  带 `Authorization: Bearer ${SEMANTICA_API_KEY}`，对面校验的是它自己的 `API_TOKEN`。
  `SEMANTICA_ENABLED=true` 而密钥缺失时启动期校验即失败——否则第一次推理才会暴露，
  而上层把 401 归一成 `unauthorized` 后呈现给模型的是"推理服务不可用"。
- `SemanticaClientService` —— 纯 HTTP 客户端（`GET /schema`、`POST /query`、
  `GET /rules`、`POST /reason`、`GET /health`）；把 sidecar 的结构化 `detail.kind`
  （`not_read_only` / `syntax_error` / `unsupported_feature` / `timeout` …）归一出来，
  作为重试回路的判据。
- `AssistantToolOntologyReasoningService` —— `reason_ontology`（参数
  `question` / `limit`）。流程：读 schema → 生成 → 执行；被拒则**把 sidecar 的报错
  回喂模型重生成**（`SEMANTICA_MAX_GENERATION_ATTEMPTS` 3 次，
  `SEMANTICA_REASONING_BUDGET_MS` 30s 总预算）。重试回路是生产必需：实测模型会产出
  `OPTIONAL MATCH ... AS x` 这类非法语法，回喂报错即可自纠。
- `AssistantToolRuleReasoningService` —— `reason_rules`（参数
  `intent` / `query` / `drug_names` / `atc_prefixes` / `limit`），走 sidecar 的
  `POST /reason`。它与直读的分别不是"另一个端点"而是**另一种断言**：`reason_ontology`
  读图上写了的边，它按规则推出图上没写的边（"A 抑制的酶恰好是 B 的代谢酶"）。
  因此硬约束更严：**范围必填**（`drug_names` 或 `atc_prefixes` 至少一个，全图不动点
  是分钟级计算，超时又会被读成"图上没有"）、规则 `intent` 取自 sidecar 的 `GET /rules`
  而非硬编码、`query` 必须至少钉死一个常量实参（全变量模式等于索要整个结论集）。
  每条结论带 `ruleId` 与前提引用，结论与引用各有条数/体积上限；"范围问题被拒"
  （`isAddressableReasonRejection`）与"服务不可用"分属两种 envelope。
- **envelope 带可复核路径**：`cypher`（实际执行的查询）+ `citations`（每条断言一条
  PROV-O 引用）+ `sourceTier: 'drugbank_structured'`；**零行 = DrugBank 没有这条
  断言**，不是"查不到"；`truncated` 标 `coverage: partial`。**引用由 sidecar 解析**：
  图上每条边带 `prov` id（指回来源表与来源行），sidecar 把它解成来源表 / 行键 /
  原文 / 哈希链位置；行回来了却一条引用都没有时 `verifiability` 是 `'uncited'`
  （而不是 `'citable'`），并由工具**强制重写一次**要求返回 `r.prov`。SSE 的
  `toolDetails` 投影 `citations` 与 `executedQuery`（取自 `result.cypher`，
  `reason_rules` 无此字段故不下发），来源条可点击复制 id 去复核。生成侧与
  prompt 侧的细节见 §"生成侧的硬约束"。
- **图节点超时必须高于工具预算**：`ASSISTANT_NODE_TIMEOUT_MS` = 模型超时（10s）+ 最大
  单次工具预算（默认 65s）+ 余量，当前默认 80s；工具超时与节点超时都从运行时快照按次
  读取（`readToolLimitBudgets()` / `readNodeTimeoutMs()`），调大工具预算要同步调大本键。
  原先节点默认取 `AI_MODEL_TIMEOUT_MS`（10s），比
  `reason_ontology` 自己的 45s 预算还小——实测表现是慢查询被节点超时掐断、
  LangGraph 重试三次，客户端只拿到每次尝试的半截答案，最后以
  `Node "agent" exceeded its run timeout` 结束。
- **与中文散文检索各自独立判定**：`ASSISTANT_OAG_TOOL_NAMES` 与
  `ASSISTANT_RETRIEVAL_TOOL_NAMES` 分开，一个 sidecar 挂掉不会把另一个的工具标成
  不可用；两者都报 `disabledReason: 'retrieval_unavailable'`（客户端渲染同一个
  "来源暂不可用"，具体是哪个由工具 envelope 说清）。
- **生成侧的硬约束写在 prompt 里**：值走 `params`；必须显式 `LIMIT`；变长路径必须锚定
  且有界（无锚定遍历会被事务超时取消）；**名称必须 `toLower()` 匹配** ——
  图上名称按 DrugBank 原样大写，精确匹配会静默返回 0 行，而那会被说成
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
  （[ADR-0021](../../../docs/reference/adr/0021-semantica-english-side-oag.md)）。它自带的四类生成（答案 / 查询 / 本体候选 / 实体关系抽取）都不用，
  "解释"也不走 `ExplanationGenerator`（它吃不了 Datalog 的字符串输出）——我们自己的
  "规则名 + 前提引用"就是解释。Rete 需要 `Rule` 对象而非 Datalog 文本且没有
  fixpoint；SPARQL 需要三元组库（Oxigraph 在本仓只是 extra）；时态与决策记录没有
  产品场景。
- **不引入它的嵌入 / NER / 消解 / 文档解析链路**：英文侧走确定性灌入，用不到。
- **不把推理结论写成诊断或用药建议**：结论只作为"待复核的潜在关系"呈现，
  不进入任何自动建议（`reason_rules` 的每条结论带 `ruleId` 与前提引用，
  `derivedNote` 明确要求按"推导"而非"断言"陈述）。

### 工具参数（模型定窗）

工具调用参数经 `AssistantToolCall` 从 `agent` 节点一路带到执行层
（`AssistantToolExecutionContext.toolArgs`），**不再**从 `userMessage` 文本猜
参数。带参数的工具目前有六个（`adapters/acl/tools/shared/tool-definitions.ts` 的
`TOOL_PARAMETERS`）：`get_meal_digest`（`days` / `limit`）、
`search_cn_knowledge`（`query` / `source` / `mode` / `limit`）、
`resolve_drugbank`（`query`，只给药品名而非整句）、
`search_drugbank`（`query` + `drugbankId` / `drugName`）、
`reason_ontology`（`question` / `limit`）与 `reason_rules`
（`intent` / `query` / `drug_names` / `atc_prefixes` / `limit`）。以 `get_meal_digest` 为例：`days` / `limit`
由模型给出，服务端封顶最近 `15` 天、最多 `20` 餐（封顶写进 envelope 的
`ambiguities` + `coverage: partial`）；它读餐食投影列判定 `analyzed` 并取
headline/区间，只为返回的 ≤`limit` 条回读 `payload.mealAnalysis` 取
`items` / `dishes`，从而**不再重复识图**。无参数工具的参数 schema 仍是空对象。

## Persistence & Memory

`repositories/`：conversation/memory/summary 三仓 + `AssistantCheckpointerService`
（Postgres checkpointer）。跨对话记忆由归档对话后台去抖抽取，注入上限 5 条；
删除对话不删除记忆，`DELETE memory` 是设置页全量清除入口。assistant 对话与
历史 Today/Report AI 摘要是两回事。

## 医学问答语料的编辑面（`application/` + `infrastructure/persistence/qa-chunks.ts`）

`medical_qa_chunks` 是**本上下文自己的检索事实源**——assistant 回答所依据的
LightRAG `qa` workspace 由这些行构建，所以编辑权归这里，不再挂在 `medicines`。

- `application/ports/qa-chunks.ts` — `ASSISTANT_QA_CHUNK_REPOSITORY` token 与
  `QaChunkRepositoryPort`（`list` / `findEditable` / `update`）。
- `infrastructure/persistence/qa-chunks.ts` — `AssistantQaChunksRepository`
  （Prisma 实现；`qaId` 是语料身份、由导入脚本赋值，不在可编辑字段里）。
- `application/use_cases/qa-chunks-admin.ts` — `QaChunksAdminService`，
  列表分页 / `q` / `safetyLabel` 过滤，写作记审计 actor + 前后摘要。

**写路径在模块之外**：`scripts/import/medicine/import-medical-qa.ts`（裸 `pg`，
不经 Nest DI）灌入语料，`rebuild-lightrag-index.ts --workspace=qa` 建索引。
因此**编辑只落库、不即时生效**——要等重建索引才进检索；且下一次重新导入会覆盖整行。
`safetyLabel = 'blocked'` 的行在建索引时被跳过，这是这条语料的**安全刹车**。

**`AssistantContentModule`（`assistant-content.module.ts`）** 单独承载这个编辑面，
不从 `AssistantModule` 导出。原因是模块依赖环：`AssistantModule` →
`DailyRecordsModule` → `HealthEventsModule` → `ProductEventsModule` → `AdminModule`，
而 admin 控制台是这个编辑面的唯一消费方；把它注册进 `AssistantModule` 会让
`admin` 依赖一条绕回 `admin` 的图。窄模块只声明编辑面，admin 因此能拿到能力而不牵入
assistant 的运行时图（`PrismaModule` 与 `AuditLogModule` 都是 `@Global`，无需 `imports`）。

## Dependencies

Imports：Auth、LlmCommon、LlmRuntime、Medicines、UserSettings、
UserHealthContext、DailyRecords、MedicineReminders。Port DI（ADR-0009）：
`MEDICINE_REMINDER_READER`、`DAILY_RECORD_READER`、
`DAILY_RECORD_CANDIDATE_GENERATOR`，以及类令牌 `DailyRecordReaderPort`
（餐食 digest 的范围读）。Barrel 导出 `HistoricalAiSummaryService`（reports 消费）
与 `QaChunksAdminService`（admin 内容管理消费）。

## Tests

`assistant.controller.spec.ts`、`services/core.service.spec.ts`、
`adapters/agent/*.spec.ts`（graph/nodes/respond/review/validate/model-stream 等）、
`tools/**/*.spec.ts`
（含 `retrieval/lightrag-client.service.spec.ts` 与
`retrieval/knowledge.service.spec.ts`：成功/超时/4xx/5xx/未配置/qa 选 mix 被拒/
leaflet 评测前选 mix 被拒/空结果/溯源缺失标 partial）、
`repositories/conversation.repository.spec.ts`、`services/policy.service.spec.ts`、
`application/use_cases/qa-chunks-admin.spec.ts`。

`graph.spec.ts` 钉的是循环本身：绑定全量候选集、多轮跨域工具调用、循环上限可见
（`tool_cap_reached`）、空覆盖与缺提案的 stop reason、以及 `respond` 不覆盖上游判定。
`nodes.spec.ts` 钉 `agent` 的三条边界：绑全量、空文本不当答案、无候选时 `no_match`。
