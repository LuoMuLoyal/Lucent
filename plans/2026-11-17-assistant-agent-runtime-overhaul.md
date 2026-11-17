# Assistant Agent 运行时重构：单循环、多轮工具、MCP、deepagents、长期记忆

> 立项 2026-11-17。目标是把 assistant 从「意图路由 + 固定子图」改成**单一 ReAct 循环**，
> **引入 deepagents 做多智能体与文件系统**，**只把一部分工具包成 MCP server**，
> 长期记忆**改用成熟开源方案而不是自己手写**。
>
> **定位：普通软件。** health/medical 不再是设计前提。原 `docs/reference/assistant-safety.md`
> 里的医疗专属红线、`EXTRACTION_SYSTEM_PROMPT` 的「discard any medical advice」等条款
> 本计划一律按**通用产品**口径重新裁决，不再默认继承。理由见 §1.3。

## 0. 已完成的准备工作（2026-11-17）

依赖已经升级并验证，**不再是本计划的风险项**：

| 包                                         | 原     | 现         |
| ------------------------------------------ | ------ | ---------- |
| `@langchain/langgraph`                     | 1.4.21 | **1.7.5**  |
| `@langchain/core`                          | 1.2.17 | **1.4.1**  |
| `langchain`                                | 1.5.16 | **1.6.6**  |
| `@langchain/langgraph-checkpoint`          | ^1.1.6 | **^1.2.3** |
| `@langchain/langgraph-checkpoint-postgres` | ^1.0.6 | **^1.1.4** |
| `@langchain/openai`                        | 1.6.2  | **1.8.4**  |
| `deepagents`                               | —      | **1.17.0** |
| `langsmith`                                | —      | **0.12.0** |
| `@langchain/langgraph-sdk`                 | —      | **1.17.0** |

验证结论：`typecheck` 0 error；assistant 模块 **580 个测试全过**；
`lint:check` 0 error（2 个既有 warning）；`deepagents` 可 import，
`createDeepAgent` 存在，导出含 `FilesystemBackend` / `LocalShellBackend` /
`StateBackend` / `StoreBackend` / `CompositeBackend` / `createSubAgentMiddleware` /
`createFilesystemMiddleware` / `createSkillsMiddleware` 等。
`pnpm peers check` 无新增冲突（3 条为既有无关项：@types/react、bullmq、uuid）。

## 1. 为什么重做

### 1.1 触发缺陷（可复现）

第一轮问「布洛芬有什么副作用」，第二轮问「那你查一下」，**第二轮没有任何工具可用**。

根因在 `adapters/agent/graph.ts:97`：

```ts
return deps.routeTools({
  userMessage: state.userMessage, // ← 只有当前这一条
  locale: state.locale,
  enabledContextSources: state.enabledContextSources,
  candidateTools,
});
```

`classify_intent` 节点每轮只把**当前这一条消息**交给路由模型，没有会话历史。
「那你查一下」四个字脱离上下文无法判定需要哪个工具 → `selectedTools` 为空 →
`deriveIntent([])` 返回 `simple_chat`（`application/services/intent.ts:64-66`）→
条件边直接跳 `respond` → 不绑任何工具。

更糟的是 `classify_intent` 带 `cachePolicy: { ttl }`，缓存键是
`(user, message, 候选集)`。**「那你查一下」这类短语会稳定命中同一个「无工具」结果**，
错误可复现且不会自愈。

### 1.2 结构性缺陷

| 缺陷                           | 位置                               | 后果                                          |
| ------------------------------ | ---------------------------------- | --------------------------------------------- |
| 路由与执行分离，路由看不到历史 | `graph.ts:85-102`                  | 多轮指代全部失效                              |
| 意图是从工具集**反向投影**的   | `intent.ts:61-93`                  | 用户问什么 → 走哪个图，取决于工具被分到哪一堆 |
| 子图硬切换，进得去出不来       | `subgraphs/read.ts:21-22` 注释自述 | 读记录途中要查药品 → 无法转场                 |
| 工具名是 `as const` 穷尽联合   | `tool-permission.ts:56-81`         | 加工具改 4 处；MCP 动态工具塞不进             |
| 一轮对话 3+ 次模型调用         | 路由 + agent + respond             | 第一次的唯一产出是工具名数组                  |

### 1.3 参照实现：DeepSeek Harness 与 WeKnora

本计划的设计参照两处实现，均读自源码/README 而非推测。

**DeepSeek Harness**（本机 `@deepseek-ai/dsh@0.2.2-rc.3`）：

- `dsh-agent-loop` **没有意图路由节点**。每个 step 发送完整派生历史 + 全部可见
  tool schema，模型自己决定。Known Limitations 明确写「**No built-in turn budget**
  — tool calls or steering continue the current turn」。
- `dsh-mcp-client`：工具名 `mcp__<serverName>__<rawName>` 是纯函数契约；
  **整代替换**（sync 失败保留上一代，注册冲突回滚整代）；stdio 子进程环境按
  `/KEY|PASSWORD|SECRET|TOKEN/i` 与 `DSH_*` 清洗。
- `dsh-bash-sandbox`：三模式；拒绝是结果事实；「**never a silent unconfined run**」。
- `dsh-agent-team`：`subagent` 新起 / `subagent_fork` 继承已完成轮次；
  扁平任务板，全部 compare-and-set。

**腾讯 WeKnora**（`Tencent/WeKnora`，MIT，v0.9.0，Go + Vue）。
读 `internal/types/memory.go` 得到的记忆设计事实（这是本计划 §7 的主要依据）：

- **五类记忆**：`profile` / `preference` / `fact` / `task` / `interest`。
  前两类 + `interest` 是 **resident**（每轮注入），后两类只在查询命中时拉取。
- **三种来源**：`explicit`（用户明说要记）/ `extracted`（后台抽取）/ `manual`。
- **四种状态**：`active` / `superseded` / `archived` / **`pending`**。
  `pending` 是系统**推断**出来的记忆，**只在管理界面可见、永不进入 prompt**，
  等用户确认。源码注释：「asserting a wrong guess silently is how a memory
  feature loses trust for good」。
- **`normalized_key` + `topic`**：同一 key 的新条目**supersede** 旧条目，
  矛盾解决不需要读路径上跑 LLM。`topic` 单独存可读答案（「在用的数据库」）。
- **时间语义**：`valid_from` / `invalid_at`（失效而非删除）/ `expires_at`
  （只对一段时间为真的东西，「这周把迁移做完」）/ `last_used_at` / `use_count`。
- **预算按 rune 而非 token**：resident block 900、recall 600 / 最多 5 条、
  `search_memory` 工具 2000 / 最多 20 条。理由：读路径上没有 tokenizer。
- **两档写入模式**：`explicit_only`（不起后台 LLM 调用）与 `auto`。
- **向量召回可选**：`EmbeddingModelID` 为空则「语义召回关闭，匹配退化为词法」；
  `vector_recall` 失败降级词法，「never becomes a reason a chat is slow」。
- **抽取消歧**：`ExtractDelaySeconds`（等一轮说完再抽）、
  `ExtractMinIntervalSeconds`（限成本，但**绝不丢 turn**，落在间隔内的排队下次跑）、
  `ConsolidatedAt`（整体复盘，因为单轮抽取看不见「五轮说了同一件事」）。
- **`PendingSessions` 落库**而非进程内队列，`ExtractCursor` 是遗忘水位。

## 2. 目标与非目标

**目标**

1. 多轮工具调用：一轮内可连续调用、跨领域转场，不受子图边界阻断。
2. 删除意图路由层，工具选择交回模型 function calling。
3. **一部分**工具包成 MCP server（范围见 §5，不是全部）。
4. **引入 deepagents**，做子智能体 + 文件系统 + 代码执行（§6）。
5. 长期记忆改用**开源方案**，不自研（§7）。

**非目标**

- 不改 `today-analysis` / `today-suggestion` / `reports` 的 AI 调用路径。
- 不做跨服务事件总线（ADR-0025 的 RabbitMQ 与本计划无关）。
- 不修改微服务拆分计划。

## 3. Phase 1：修路由缺陷（先做，独立可验收）

半天成本，用现有架构验证 §1.1 的根因判断。**若直接重构，重构后发现
「那你查一下」仍不可用，就分不清是哪一层的责任。**

### 3.1 改动

- `adapters/agent/state.ts`：新增 `routeHistory: Annotation<BaseMessage[]>`，
  reducer 与 `messages` 相同。
- `application/services/intent-classifier.ts:35-40` 的
  `AssistantToolRoutingContext`：增加 `history: readonly {role, content}[]`。
- `adapters/agent/graph.ts`：`classify_intent` 节点从 `state.messages` 取最近
  `DEFAULT_HISTORY_LIMIT` 条传入 `routeTools`。
- `application/services/intent-router-prompt.ts`：候选工具目录**放在历史之后**
  （工具目录是硬约束，位置靠后更醒目）。
- `classify_intent` 的 `cachePolicy` 键**必须包含历史摘要的 hash**。
  **这是本步最容易漏的地方**：加历史却不改缓存键，缺陷会以「换汤不换药」
  的形式复现。

### 3.2 验收

- 单测：历史进入用户提示词；同一末句 + 不同历史选出的工具不同。
- 手工复现：「布洛芬有什么副作用」→「那你查一下」，第二轮必须绑定知识检索类工具。
- `pnpm typecheck`、`pnpm lint:check`。

## 4. Phase 2：删路由层，单一 ReAct 循环

### 4.1 目标拓扑

```text
START → prepare_context → agent ⇄ tools → respond → END
```

`agent` 绑定 `state.allowedTools` **全量**（permission 已算好的候选集）。

### 4.2 删除清单

| 删除                                                                     | 理由                |
| ------------------------------------------------------------------------ | ------------------- |
| `application/services/intent-classifier.ts`                              | 路由层退役          |
| `application/services/intent.ts`（`deriveIntent`）                       | 意图不再需要        |
| `intent-router-prompt.ts`、`intent-routing.ts`、`intent-eval.fixture.ts` | 随路由层退役        |
| `adapters/agent/subgraphs/{read,write,knowledge}.ts`                     | 硬切换是缺陷        |
| `graph.ts` 的 `classify_intent` + 五路条件边                             | 改 `agent` 单一入口 |
| `state.ts` 的 `intent`/`relevantTools`/`activeSubGraph`/`routingSource`  | 无消费者            |

`validate.ts` **保留**：`validateReadResults` 的空结果/部分覆盖标记移到
`tools` 之后、`respond` 之前。它解决的是「模型把空结果说成有结果」，与路由无关。

### 4.3 系统提示词收敛

4 个提示词（simple/read/write/knowledge）收敛为一个，工具清单由
`buildToolDefinitions` 动态拼入。`selectSystemPrompt`（`graph.ts:104-134`）删除。

按 DSH `tool-design.md` 重写：删掉模型能从结果学到的约束、描述行为不描述实现、
**每条事实只说一次**、参数规则下沉到参数描述。

### 4.4 循环上限

`MAX_TOOL_LOOPS = 3` 改为运行时可配 `ASSISTANT_MAX_TOOL_LOOPS`，基线 3 → 8。
上限必须可见（`stopReason: 'tool_cap_reached'` 已有）。

### 4.5 验收

- 跨领域单轮：「查我上周的饮食 → 再查这几个药的相互作用 → 给结论」
  在一个 turn 内完成。
- 原有 e2e 全绿；`arch:check` 不新增条目。

## 5. Phase 3：MCP —— **只包一部分工具**（范围收窄）

### 5.1 明确的取舍

**不是全部 24 个工具都做成 MCP。** 按「谁需要从 Lucent 之外调用」来分：

| 组                                                                                       | 工具 | 是否 MCP           | 理由                                                                |
| ---------------------------------------------------------------------------------------- | ---- | ------------------ | ------------------------------------------------------------------- |
| **知识检索**（`search_cn_*`、`get_drugbank_detail`、`reason_over_*` 等）                 | 8 个 | **是**             | 无用户数据、与其他系统/agent 天然可复用；且这是「知识库」能力的出口 |
| **常青事实**（`get_*_summary`、`get_user_profile` 等只读）                               | 部分 | **是**（只读子集） | 只读、幂等，适合被外部 agent 复用                                   |
| **用户私有数据**（`get_records_*`、`get_current_medicines`、`get_meal_analysis_digest`） | —    | **否**             | 与 `userId` 强绑定，跨进程暴露只会放大越权面                        |
| **写入提案**（`propose_*`）                                                              | 4 个 | **否**             | HITL 门控依赖会话与确认状态，跨进程无意义                           |

**判断标准是「这个工具被 Lucent 之外的调用方调用时，语义是否还成立」。**
`propose_create_daily_record` 离开会话与 confirm 端点就没有意义，包成 MCP
只是把一套状态机切成两半。

### 5.2 实现要点（照搬 DSH）

- 新增 `adapters/mcp/`（不进 `acl/tools/`）：`server.ts`（transport 装配）、
  `tool-bridge.ts`（映射）、`context.ts`（身份注入）。
- **命名**：`mcp__<serverName>__<rawName>`，`serverName` 固定 `lucent`。
  名字是 `(serverName, rawName)` 的**纯函数**，不用任何运行时可变值——
  会话历史与权限规则挂在这个名字上。
- **整代替换**：一次 list 原子发布；任一工具注册失败 → 整代回滚，不发布半个集合。
- **身份**：stdio 走进程 env；streamable-http 走 `Authorization` bearer。
  **不复用 `SEMANTICA_API_KEY` 那条共享 token**——那条通道本身还挂在
  `docs/TODO.md` 的「AMQP 链路没有 TLS」隐患里。
- **外部 MCP client（地图 / 天气）**：由本进程作为 client 接，它们没有用户数据。
  走 `@modelcontextprotocol/client`（DSH 同款），工具名同样 `mcp__<server>__<raw>`。

### 5.3 与 `as const` 穷尽检查的冲突（需 ADR）

`TOOL_REQUIRED_SOURCES` 是 `satisfies Record<ToolName, ...>` 穷尽检查，
新增动态工具会绕过「用户哪些数据可读」这道闸。方案：内置组保持静态穷尽；
外部组走独立 `ExternalToolName` 类型，**类型上只能声明 `requiredSources: []`**。
任何外部工具想读用户数据必须先晋升为内置工具（改代码、过穷尽检查）。

## 6. Phase 4：引入 deepagents（子智能体 + 文件系统 + 代码执行）

### 6.1 定位

deepagents 提供：`write_todos` 规划、`read_file`/`write_file`/`edit_file`/`ls`/
`glob`/`grep` 文件系统、`task` 子智能体（隔离上下文窗口）、
`createSummarizationMiddleware` 上下文管理、`createSkillsMiddleware` 渐进披露、
`createSubAgentMiddleware` 动态子智能体。

**接入方式：deepagents 作为 assistant 的运行时外壳，替换 Phase 2 手写的
ReAct 循环。** 即 Phase 2 先手工收敛成单循环（验证拓扑正确），Phase 4 再换成
`createDeepAgent`——两步分开，才能分清「循环设计错」与「框架接入错」。

### 6.2 子智能体划分

按领域切分（不是按工具切分）：

| 子智能体    | 职责                   | 工具                                 |
| ----------- | ---------------------- | ------------------------------------ |
| `knowledge` | 药品知识检索与本体推理 | 8 个检索工具                         |
| `records`   | 用户记录读取           | 只读用户数据工具（进程内，不经 MCP） |
| `analyst`   | 代码执行与数据分析     | 文件系统 + shell + 沙箱              |
| `general`   | 默认兜底               | 全部候选                             |

`SubAgent` 的必填字段是 `name` / `description` / `systemPrompt`，
可选 `model` / `tools` / `middleware` / `interruptOn` / `skills`。

### 6.3 沙箱（与 deepagents 的 backend 对应）

- `FilesystemBackend` — 真实文件系统；`StateBackend` — 内存态；
  `StoreBackend` — 持久 store；`CompositeBackend` — 组合。
- `LocalShellBackend` 官方警告：**unrestricted filesystem access + unrestricted
  shell execution on the host**，明确列为「Inappropriate use cases: Production
  environments (e.g., web servers, APIs, multi-tenant...)」。
  **因此不直接用 `LocalShellBackend`**，按 DSH 的三模式包一层：
  `read-only`（默认）/ `workspace-write` / `danger-full-access`。
- 拒绝是结果事实，升级需一句话理由；**无 runner 时报错，不静默直跑**。
- **多租户差异**：每会话一个独立临时 workspace。DSH 是单用户 CLI 不需要，
  Lucent 是 Web 多租户必须有。

### 6.4 验收

- 子智能体可被 `task` 工具委派并返回结果。
- 文件系统工具在 `workspace-write` 下只能写 workspace 内。
- shell 默认 `read-only`，越界被拒且结果带模式标记。

## 7. Phase 5：长期记忆 —— 用开源方案

### 7.1 现状（自研，5 个可指出的缺陷）

| 问题                                                   | 位置                |
| ------------------------------------------------------ | ------------------- |
| 只注入最近 5 条，无相关性                              | `memory.ts:100-104` |
| 只在归档对话时提取，**活跃对话里的偏好永远不进记忆**   | `memory.ts:181-203` |
| 进程内 `setTimeout` debounce，重启即丢（代码注释自承） | `memory.ts:70-73`   |
| 仅同批次内去重，同一偏好说三遍是三行                   | `memory.ts:73-92`   |
| 按 `createdAt desc` 排序，旧但重要的记忆永远进不了前 5 | `memories.ts`       |

### 7.2 选型

**不自研。** 按「是否可自托管 / 是否有 TypeScript 或 REST 接口 / 是否支持多租户
`user_id` 隔离 / 是否成熟」四条筛：

| 方案                        | 形态                                                                                                                                | 判断                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Mem0**（`mem0ai`）        | 库（`npm install mem0ai`，`Memory` 类）或自托管 REST server（Docker，含 dashboard、per-user API key、审计日志，`/docs` 有 OpenAPI） | **首选**：TS 原生、`user_id`/`agent_id`/`run_id` 三级作用域、社区最大、可先库后服务                    |
| **Zep / Graphiti**          | Graphiti 是 Apache-2.0 时序知识图谱框架（需 Neo4j/FalkorDB）；Zep 商业版                                                            | 备选：已有 Neo4j（`apps/ontology` 用着），时序边（`valid_from`/`invalid_at`）与 WeKnora 的时间语义一致 |
| **OpenMemory / LongMemory** | 自托管，pgvector，MCP 兼容 HTTP 端点，五扇区记忆 + 时序事实图                                                                       | 备选：MCP 原生、有可解释回溯路径                                                                       |
| **WeKnora**                 | 完整知识平台（Go + Vue，MIT，Docker），记忆只是其中一块                                                                             | **不作为记忆方案引入**（是整平台，改造成本远超收益），但其**记忆数据模型是本计划的设计参照**           |

**决策：Phase 5 用 Mem0 的 TS 库**，`Memory({ config })` 直连既有 Postgres，
不引入新中间件；若后续需要独立服务再切它的 REST server。

### 7.3 数据模型对齐 WeKnora（本计划采纳的部分）

即使不引入 WeKnora，它 `internal/types/memory.go` 的设计应直接照搬到
我们自己的落库结构（Mem0 的 metadata 与自定义字段足以承载）：

- **五类**：`profile` / `preference` / `fact` / `task` / `interest`。
  `profile`/`preference`/`interest` 每轮注入；`fact`/`task` 按查询匹配。
- **`pending` 状态**：系统推断的记忆**不注入 prompt**，等用户确认。
  这条是本计划从 WeKnora 学到的最重要一条——静默断言错误猜测会永久失去信任。
- **`normalized_key` + `topic`**：同 key 新条目 supersede 旧条目，矛盾在写路径解决。
- **时间语义**：`valid_from` / `invalid_at`（失效不删除）/ `expires_at` /
  `last_used_at` / `use_count`。
- **预算**：resident 900 rune、recall 600 rune / 5 条、`search_memory` 2000 rune / 20 条。
- **两档写入**：`explicit_only` / `auto`。
- **向量召回可关**：embedding 不可达时退化为词法匹配，**不阻塞对话**。

### 7.4 提取调度（不改用队列也会变好的部分）

WeKnora 的 `ExtractDelaySeconds` + `ExtractMinIntervalSeconds` +
`PendingSessions` 落库 + `ConsolidatedAt` 整体复盘，这四条直接替换现有
`memory.ts` 的进程内 `setTimeout`：

- 落库到 `assistant_memory_extraction_queue`（或复用 BullMQ，见 §9 决策点），
  **进程重启不丢**。
- 延迟窗口合并一条 turn 的多条消息。
- 最小间隔限成本但**不丢 turn**（落在间隔内的排队）。

### 7.5 验收

- 同一偏好说三遍 → 一行（`normalized_key`）；用户改主意 → 旧行 supersede。
- 活跃对话中的偏好，turn 结束后进入记忆。
- 推断出的记忆状态是 `pending`，**不进入 prompt**，能在管理界面看到。
- 进程重启后待提取任务不丢。
- `DELETE /memory` 仍幂等清空全部。
- embedding 不可达时检索退化为词法，对话不阻塞，`capabilities` 里可见。

## 8. 执行顺序

| #   | Phase | 内容                                                    | 预估   |
| --- | ----- | ------------------------------------------------------- | ------ |
| 0   | —     | **依赖升级（已完成）**                                  | —      |
| 1   | 1     | 修路由缺陷                                              | 0.5 天 |
| 2   | 2     | 删路由层、单循环、提示词收敛                            | 1–2 天 |
| 3   | 4     | **deepagents 接入（提前）**：子智能体 + 文件系统 + 沙箱 | 4–6 天 |
| 4   | 3     | MCP：知识检索组做 server + 地图天气做 client            | 2–3 天 |
| 5   | 5     | 记忆改用 Mem0 + WeKnora 数据模型                        | 3–5 天 |

**顺序调整说明**：deepagents 提前到 MCP 之前。理由是 Phase 2 收敛出的单循环
本就是 deepagents 会替换掉的东西——先接 deepagents，MCP 那一步直接在
deepagents 的工具体系里做，不用写两遍。

每步收尾：

```bash
pnpm --filter monolith typecheck
pnpm --filter monolith lint:check
pnpm --filter monolith test
pnpm --filter monolith arch:check
pnpm export:openapi        # 端点变了才跑
pnpm docs:verify && pnpm docs:links
```

并按 AGENTS.md 向 `docs/logs/migration-log/YYYY-MM-DD.md` 追加当日条目。

## 9. 需要裁决的两件事

1. **`docs/reference/assistant-safety.md` 的去留。** 按普通软件口径，
   其中 Knowledge-Source Boundaries（检索源不合并、引用可解析、缺失≠不存在）
   是**正确性**要求，应保留；AI Safety Policy（不得给出诊断/处方/剂量调整）
   是产品边界，需产品侧确认。**不要在重构中顺手删掉整个文件。**
2. **记忆提取的调度载体。** WeKnora 用落库的 `PendingSessions` + 游标；
   Lucent 已有 BullMQ。二选一（我倾向 BullMQ，基建已就绪且有面板）。

## 10. 已知风险

- **Phase 2 改动面最大**：删 3 个子图 + 路由层，牵动
  `stream-message.ts:131` 的 `policy.enabledToolNames` 与
  `adapters/agent/runtime.ts:294,547` 两处 `selectTools`。
  按「先加新路径 → 灰度切 → 再删旧路径」三步走。
- **全量绑定工具后 prompt token 上升**。`reason_over_ontology` 与
  `reason_over_rules` 的描述已接近 DSH 判定「该拆进参数」的长度，
  §4.3 重写时压缩这两条。
- **deepagents 的 `LocalShellBackend` 不可直接用于生产**（官方明确列为不适用）。
  §6.3 的自包装层是本 Phase 的主要工作量，不是 deepagents 本身。
- **Mem0 需要确认**：其 TS 库默认后端是 Qdrant 还是可配 Postgres/pgvector，
  以及 `normalized_key`/`pending` 这类自定义字段能否落进 metadata。
  这在 Phase 5 开工前必须实测，不能只读文档。
