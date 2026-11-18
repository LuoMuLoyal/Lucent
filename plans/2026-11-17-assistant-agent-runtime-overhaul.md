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

## 3. Phase 1：修路由缺陷（已实施）

半天成本，用现有架构验证 §1.1 的根因判断。若直接重构，重构后发现
「那你查一下」仍不可用，就分不清是哪一层的责任。

### 3.1 实现与计划的三处偏离

原计划写的是「从 `state.messages` 取最近 N 条」，实测后改了：

1. **历史来自请求体（`dto.messages`），不是 checkpoint。** 无状态对话
   （无 `conversationId`）没有 checkpoint 可读，而两条路径都必须能用。
   因此新增 `conversationHistory` 通道，由 `stream-message.ts` 从请求消息
   取最近 6 轮、排除末条、丢弃空内容。
2. **缓存键用显式 `keyFunc`，不是「含历史摘要的 hash」。** LangGraph 的默认键是
   `XXH3(JSON.stringify([packet.args]))`（`pregel/algo.js:447`），哈希的是节点
   输入。「输入里含历史」不等於「键里含历史」——reducer 合并与通道子集都会改变
   实际参与哈希的内容。显式列出 `userMessage` / `locale` / `enabledContextSources` /
   `allowedTools` / 历史尾 6 轮 / `memoryInjected` / 提示词指纹，把契约写死。
3. **`selectTools` 的 `history` 参数必填、不给默认值。** 若写成 `history = []`，
   调用点漏传会静默退化成无历史且测试全绿，正是原缺陷的形态。必填后编译器
   一次性报出全部 6 处漏传。

### 3.2 验收结果

- `intent-classifier.spec.ts` 新增 3 条：历史进入提示词的**位置顺序**
  （工具目录 → 历史 → 本轮消息）、空历史不渲染空区块、超长单条被截断。
- `graph.spec.ts` 新增 2 条：贯穿整图断言追问不再塌成 `simple_chat`；
  同一句追问在**不同历史下路由到不同工具**（钉住缓存键必须含历史）。
- `typecheck` 0 error；`intent-classifier.spec.ts` 9 passed；
  `graph.spec.ts` 19 passed。

## 4. Phase 2：删路由层，单一 ReAct 循环（已实施）

### 4.1 目标拓扑

```text
START → prepare_context → agent ⇄ tools → validate → respond → END
                                        └→ capped ↗        └→ write_review_*（HITL）
```

`agent` 绑定 `state.allowedTools` **全量**（permission 已算好的候选集）。

### 4.2 已删除

| 删除                                                                     | 理由                |
| ------------------------------------------------------------------------ | ------------------- |
| `application/services/intent-classifier.ts`（+ spec）                    | 路由层退役          |
| `application/services/intent.ts`（`deriveIntent`）                       | 意图不再需要        |
| `intent-router-prompt.ts`、`intent-routing.ts`、`intent-eval.fixture.ts` | 随路由层退役        |
| `adapters/agent/subgraphs/{read,write,knowledge}.ts`（+ spec）           | 硬切换是缺陷        |
| `graph.ts` 的 `classify_intent` + 五路条件边                             | 改 `agent` 单一入口 |
| `state.ts` 的 `intent`/`relevantTools`/`activeSubGraph`/`routingSource`  | 无消费者            |
| `prompts.ts` 的 read/write/knowledge/simple-chat 四份                    | 收敛为一份          |

`validate.ts` **保留并扩展**：三个子图的 `*_validate` 合并成一个节点，
`validateReadResults` 的空结果/部分覆盖标记移到 `tools` 之后、`respond` 之前。
它解决的是「模型把空结果说成有结果」，与路由无关。

### 4.3 实施中发现的三个真实缺陷

计划没有预见到，是实现与测试逼出来的：

1. **`tool_cap_reached` 不可达。** `tools` 每次迭代都清空 `pendingToolCalls`，
   所以 `validate` 看到的永远是空列表，分不清「自然结束」与「被截断」。
   修法：新增 `loopCapped` 通道 + `capped` 节点，在 `tools` **执行之后**判上限
   （不是在 `agent` 之前判——那样会砍掉模型实际请求的最后一轮）。
2. **`respond` 无条件覆盖 `stopReason`。** 它总是写 `answered`，把 `validate`
   算出的 `tool_cap_reached` 与 `no_evidence` 全部盖掉。修法：只在上游无判定时回落。
3. **`agent` 收到空文本时写 `finalContent: ''`。** 这会让 `respond` 走「已有内容」
   分支并因空串抛错，而实际情况是模型停下来了、`respond` 本可以作答。
   修法：空文本视为未作答（`finalContent: null`），交给 `validate` 解释原因。

另有一处 HITL 语义收窄：`validate` 只在**有 checkpointer** 时写 `pendingReview`。
无 checkpointer 时没有任何东西会挂起，写它等于告诉调用方「有待确认的提案」，
而实际上没人会暂停。

### 4.4 系统提示词收敛

4 个提示词收敛为一份（`buildAssistantSystemPrompt`），工具清单由
`buildToolDefinitions` 动态拼入。`selectSystemPrompt` 删除。

按 DSH `tool-design.md` 重写：删掉模型能从结果学到的约束、描述行为不描述实现、
**每条事实只说一次**、参数规则下沉到参数描述。`prompts.spec.ts` 相应重写，
原来四份各自的断言合并为对唯一提示词的断言（安全属性一条不减）。

### 4.5 循环上限

`MAX_TOOL_LOOPS` 3 → 8，改为运行时可配 `ASSISTANT_MAX_TOOL_LOOPS`
（`retrieval.schema.ts` 的 `numberField`，min 1 / max 32 / 默认 8）。
上限可见：`stopReason: 'tool_cap_reached'`。

### 4.6 验收结果

- `typecheck` 0 error；`lint:check` 0 error（2 个既有 warning）。
- assistant 模块 **44 files / 552 tests 全过**（原 580，减少的是路由层与子图测试）。
- `arch:check` 不新增条目；基线里指向已删文件的那条已收缩。
- 跨域单轮由 `graph.spec.ts` 的 "keeps calling tools across several rounds in one turn"
  钉住：一次 turn 内先读记录再查药品。

## 5. Phase 3：MCP —— **只包一部分工具**（范围收窄）

### 5.1 明确的取舍

**不是全部 24 个工具都做成 MCP。** 按「谁需要从 Lucent 之外调用」来分：

| 组                                                                                       | 工具 | 是否 MCP           | 理由                                                                |
| ---------------------------------------------------------------------------------------- | ---- | ------------------ | ------------------------------------------------------------------- |
| **知识检索**（`search_cn_*`、`get_drugbank_detail`、`reason_over_*` 等）                 | 8 个 | **是**             | 无用户数据、与其他系统/agent 天然可复用；且这是「知识库」能力的出口 |
| **常青事实**（`get_*_summary`、`get_user_profile` 等只读）                               | 部分 | **是**（只读子集） | 只读、幂等，适合被外部 agent 复用                                   |
| **用户私有数据**（`get_records_*`、`get_medicines`、`get_meal_digest`） | —    | **否**             | 与 `userId` 强绑定，跨进程暴露只会放大越权面                        |
| **写入提案**（`propose_*`）                                                              | 4 个 | **否**             | HITL 门控依赖会话与确认状态，跨进程无意义                           |

**判断标准是「这个工具被 Lucent 之外的调用方调用时，语义是否还成立」。**
`create_record_draft` 离开会话与 confirm 端点就没有意义，包成 MCP
只是把一套状态机切成两半。

### 5.2 传输：只做 Streamable HTTP，不提供 stdio

按规范实现，不发明语义。依据 [MCP 2025-06-18 · Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)。

选定 **Streamable HTTP**（不是已废弃的 HTTP+SSE，也不做 stdio）：

- **单一端点**，同时接受 `POST` 与 `GET`（`/api/v1/mcp`）。POST 送消息，GET 开 SSE
  流接收服务端推送。
- **规范要求的三条安全项**（本节最容易漏，也是唯一不能用「延迟/难度」换掉的）：
  1. **必须校验 `Origin`**，防 DNS rebinding；
  2. 本机运行时**只绑 `127.0.0.1`**；
  3. 所有连接**必须鉴权**。
     缺了这三条的 Streamable HTTP 等于给公网开了一个能改服务状态的入口。
- **会话**：`sessionIdGenerator` 生成会话 id（`Mcp-Session-Id` 响应头）。无会话 id 的
  非初始化请求按规范回 400；无效会话 id 回 404。
- **`Accept` 头**：客户端必须同时声明 `application/json` 与 `text/event-stream`；
  服务端二选一返回。不满足就按规范回 400。
- **JSON-RPC 通知 / 响应**（非请求）收到即回 `202 Accepted` 且无 body。
- **协议版本头** `MCP-Protocol-Version` 要处理，缺失时按规范回落。

不做 stdio 的理由：stdio 由客户端拉起子进程，而 Lucent 的工具执行需要 Nest DI
（Prisma、Redis、sidecar 客户端、指标）。子进程里没有容器，等于把整个依赖图重造一遍；
Streamable HTTP 从 HTTP 边界进来，DI 现成。

### 5.3 分层（ADR-0024 四层）

MCP 不是「工具的 ACL」，是**对外协议出口**，所以单独一层而不是塞进 `acl/tools/`。

| 层                   | 目录   | 内容                                                                                     |
| -------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `domain/mcp/`        | 纯领域 | 暴露哪些工具、命名契约、`requiredSources` 必须为空的约束。**不 import 框架**             |
| `application/ports/` | 端口   | 复用既有 `ASSISTANT_TOOL_EXECUTOR`；外层调用只需一个 list + 一个 execute                 |
| `adapters/mcp/`      | 适配器 | `McpServer` 装配、`StreamableHTTPServerTransport`、会话表、Origin 校验、Fastify 路由挂载 |
| —                    | —      | 不新增 `infrastructure/`：执行器与 sidecar 客户端都已在既有层                            |

依赖方向：`adapters/mcp → application/ports → domain/mcp`。`adapters/mcp` **不得**
import `infrastructure/**`（`ddd-adapters-no-infrastructure` 会拦）。

### 5.4 实现要点

- **命名**：`lucent__<rawName>`，是 `(serverName, rawName)` 的**纯函数**，
  不用任何运行时可变值。规范限制工具名字符集为 `[A-Za-z0-9_-]`，`__` 分隔符合法。
  会话历史与权限规则挂在这个名字上，改了它就断代。
- **整代替换**：一次 `tools/list` 原子发布；任一工具注册失败 → 整代回滚，
  不发布半个集合。
- **身份**：从 `Authorization` 取 bearer。**不复用 `SEMANTICA_API_KEY`**——
  那条通道本身还挂在 `docs/TODO.md` 的「AMQP 链路没有 TLS」隐患里。
- **执行必须走既有 `executeMany`**：提案信封、单工具超时、缓存、指标都在里面；
  写第二份执行器必然漂移，漂移的表现是「提案被描述成已执行的写入」。
- **`streamable-http` 用 SDK 的 `StreamableHTTPServerTransport`**（`@modelcontextprotocol/sdk@^1.32.2`），
  不手写 JSON-RPC 帧。Fastify 侧需要 `reply.hijack()` 把 `request.raw` / `reply.raw`
  交给 transport。
- **外部 MCP client（地图 / 天气）**：由本进程作为 client 接，它们没有用户数据。
  工具名同样 `lucent__<raw>` 之外的前缀规则，按各自 serverName 生成。

### 5.5 与 `as const` 穷尽检查的冲突（需 ADR）

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

### 6.4 实施结果（装配层完成，未接入请求路径）

已落地三个文件：

| 文件                            | 内容                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `adapters/agent/tool-bridge.ts` | 24 个既有工具 → `StructuredTool`，实现调用**既有** `executeMany`；6 个带参数工具用 zod 手写 schema，上界读同一份运行时预算 |
| `adapters/agent/subagents.ts`   | `knowledge` / `records` / `analyst` 三个子智能体；**不声明 `tools`**，继承父级工具集                                       |
| `adapters/agent/workspace.ts`   | 每会话临时目录 + 环境变量清洗（`/KEY\|PASSWORD\|SECRET\|TOKEN\|CREDENTIAL\|URL\|DSN\|CONN/i` 与 `DSH_*`）                  |
| `adapters/agent/deep-agent.ts`  | `createDeepAgent` 装配：模型、工具、子智能体、`LocalShellBackend`                                                          |

**没有接入 `runtime.ts`。** `graph.ts` 仍是生产路径。原因是两者在流式与返回形状上
不同（deepagents 拥有自己的 run loop 与 `messages`/`files` 状态，而 `graph.ts` 通过
`onText` 流式输出并返回 `AssistantConversationResult`）。换底座是一个独立、
可验证的步骤，混在装配里做会分不清是「装配错」还是「换底座错」。

### 6.5 与原计划的偏离：沙箱

原计划写的是「三模式沙箱 + 每会话 workspace」，**只实现了后一半**。

- **没有沙箱。** 直接用 `LocalShellBackend`（unconfined host shell）。它的原文把
  「web servers, APIs, multi-tenant」列为不适用场景，本项目的 assistant 正是这一类。
- **仍然实现的两件事**：每会话独立 cwd（否则 `pwd` 是仓库根，`.env.development`
  与源码都在那儿）、环境变量清洗（进程持有数据库 URL / Redis 密码 / provider key）。
- **`virtualMode: true` 只约束文件工具**，不约束 shell 命令。两道理应分开，混为一谈
  会让人以为 shell 也被围住了。

这是明确取舍而非遗漏：真正隔离需要每会话一个容器（独立命名空间、无网络、只挂临时
卷），是独立的基础设施改动。

### 6.6 验收状态

- ✅ 子智能体声明可被 `task` 委派（`deep-agent.spec.ts` 断言名称、描述、继承工具集）。
- ✅ 工具桥把参数原样交给 `executeMany`，超时信封渲染为模型可读文本（6 条断言）。
- ✅ 每会话 workspace 独立；非法 `conversationId`（如 `../../etc`）被拒绝。
- ✅ 环境变量清洗：凭证名、连接串名、`DSH_*` 均被丢弃。
- ❌ 文件系统工具在 `workspace-write` 下只能写 workspace 内 —— **无此模式，未测**。
- ❌ shell 默认 `read-only` —— **无此模式，shell 不受限**。
- ⬜ 真实模型端到端（子智能体实际被委派并返回）未验证：需要模型凭据，而单测只跑装配。

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

**决策：Phase 5 用 Mem0 的 self-hosted server（REST），独立 database。**

原先的「用 TS 库、不引入新中间件」判断已推翻。改判依据是它 `server/` 目录的
compose 实读结果——三个组件的边际成本远低于「引入一个中间件」的常规印象，
而且它独有的能力（运行时改 provider、审计日志、实体管理面）在库模式下拿不到。

### 7.2.1 为什么是 server 而不是库

| 能力                  | 库模式     | self-hosted server                                                          | 对本项目的价值                                                                   |
| --------------------- | ---------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 运行时改 LLM/embedder | 改代码重发 | `POST /configure`，持久到 app DB 并叠在 `.env` 之上                         | **高**：多角色模型池（chat/vision/analysis/embedding/compression）换模型不用发版 |
| 审计                  | 无         | `request_logs`（状态/延迟/auth 模式）+ dashboard                            | **高**：每条记忆写入可回溯，出问题能定位是哪次 turn 写的                         |
| 实体管理              | 自己写     | dashboard 的 Entities 页，按 `user_id`/`agent_id`/`run_id` 列计数并可级联删 | **高**：`DELETE /memory` 之外多一个可核对的操作面                                |
| per-user API Key      | 无         | `X-API-Key`（只存前缀 + bcrypt）                                            | 中：Lucent 内部调用可只用一把，不必按用户发                                      |
| 部署面                | 0          | 2 个容器（API + dashboard）                                                 | 低：compose 已就绪，pgvector 镜像族已在用                                        |

**库模式被排除的决定性理由**：`Memory` 构造时**同步探测 embedding 维度并做 LLM
连通性检查**，未显式给 `embeddingDims` 时会阻塞在网络调用上（本计划起草时两次
验证脚本都卡在这里）。把这种东西放进 Web 请求进程的依赖图中，等于给每个实例
加一个启动期网络阻塞点。放在独立容器里，这份不确定性就被隔离在进程外。

### 7.2.2 接入既有 stack 的三个硬约束

读 `server/docker-compose.yaml`、`server/.env.example`、`server/main.py` 得到：

1. **不要让它自带 Postgres。** 它的 compose 起 `pgvector/pgvector:pg17` +
   `init-db.sh` + 卷。接入时改为指向既有 `lucent-postgres-dev`，
   **新建独立 database `mem0`**，不用 `lucent` 库、不用独立 schema。
   理由：它的 Alembic 会建 `users` / `api_keys` / `request_logs` 三张表，
   `users` 与 Prisma 的 `User` 同名，同库必然撞名。独立库还能单独备份/清理。
   Mem0 需要**两个** DB 名：`POSTGRES_DB`（记忆的 pgvector 表）与
   `APP_DB_NAME`（默认 `mem0_app`，存它自己的元数据）。二者都要落在新建的库里。
2. **provider 白名单写死在 Python 里。** `main.py:62-63`：
   `BUNDLED_LLM_PROVIDERS = ("openai","anthropic","gemini")`、
   `BUNDLED_EMBEDDER_PROVIDERS = ("openai","gemini")`。不在白名单的 provider
   在 `POST /configure` 阶段就被 400 拒绝。
   **但 `openai` provider 支持 `baseURL`**（`mem0ai/dist/oss/index.js:181`：
   `baseURL: config.baseURL || config.url`），所以只要模型池是 OpenAI 兼容的，
   用 `provider: openai` + 自建 `baseURL` 即可，**不需要改它的 Python 源码**。
   这是能否零改造接入的关键点，见 §7.6 的实测要求。
3. **`AUTH_DISABLED` 不得为 true。** `JWT_SECRET` 必填（缺失则 auth 端点 500）。
   `DASHBOARD_URL` 要设成实际 origin（CORS 白名单）。
   `MEM0_TELEMETRY` 默认 `true`，**设成 `false`**——它会上报 install UUID 与
   邮件域，本项目没有理由向外发送。

### 7.2.3 库边界

```text
mem0 容器  ──REST(/memories, /search)──>  Lucent assistant
    │
    └──> lucent-postgres-dev / database "mem0"
           ├── POSTGRES_DB    = mem0        (pgvector 记忆表)
           └── APP_DB_NAME    = mem0_app    (users / api_keys / request_logs, Alembic)
```

`lucent` 库里**不新增任何表**。Lucent 侧只保留一个轻薄的 HTTP client
（`adapters/acl/memory/mem0-client.ts`），不再持有记忆的 schema。

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

### 7.6 Phase 5 的执行子步骤

按依赖顺序，每步可独立验证：

1. **建库**（无凭据依赖，立即可做）：
   `CREATE DATABASE mem0;` 与 `CREATE DATABASE mem0_app;`
   （后者的角色与库名按 `APP_DB_NAME` 配）。同时 `CREATE EXTENSION vector;`
   在 `mem0` 库上。
2. **compose 接入**：在 `compose.dev.yaml` 增加 `mem0` 与 `mem0-dashboard`
   两个 service，**删除它自带的 postgres**，`POSTGRES_HOST` 指向
   `lucent-postgres-dev`。`MEM0_TELEMETRY=false`，`AUTH_DISABLED=false`。
3. **验证 baseURL 能否复用模型池**（§7.2.2 第 2 条）：用 `provider: openai` +
   自建 `baseURL` 跑一次 `POST /configure` → `POST /memories` → `POST /search`。
   **通过 = 零改造接入；不通过 = 才需要扩展 `BUNDLED_*_PROVIDERS` 并重建镜像。**
   这一步必须有真实 embedding 端点，是整个 Phase 的go/no-go 闸门。
4. **Lucent 侧 client**：`adapters/acl/memory/mem0-client.ts`（HTTP，
   `X-API-Key` 走 env）。端口：`memory` 上下文。
5. **数据模型对齐**：§7.3 的字段落在 Mem0 的 `metadata` 还是自定义列，
   在第 3 步通过后实测确定——**不通读文档猜**。
6. **提取调度**：替换 `memory.ts` 的进程内 `setTimeout`。
7. **删除旧自研记忆**：`domain/memory/` 的落库路径 + `AssistantMemory` 表。
   迁移既有 `assistant_memories` 行到 Mem0（一次性脚本），或按裁决直接丢弃。

### 7.7 在 Phase 5 之前就该做的

§7.6 第 1–2 步（建库 + compose 接入）**不依赖 assistant 重构**，可以现在就做。
先做掉它，Phase 5 启动时就没有基础设施等待。

## 8. 执行顺序

| #   | Phase  | 内容                                                           | 预估   |
| --- | ------ | -------------------------------------------------------------- | ------ |
| 0   | —      | **依赖升级（已完成）**                                         | —      |
| 0.5 | 5 前置 | 建 `mem0` 库 + compose 接入 + baseURL 闸门验证                 | 0.5 天 |
| 1   | 1      | **修路由缺陷（已实施，见 §3）**                                | 0.5 天 |
| 2   | 2      | **删路由层、单循环、提示词收敛（已实施，见 §4）**              | 1–2 天 |
| 3   | 4      | **deepagents 装配（已实施，见 §6；未接入请求路径）**           | 4–6 天 |
| 4   | 3      | MCP：知识检索组做 server（Streamable HTTP）+ 地图天气做 client | 2–3 天 |
| 5   | 5      | 记忆接 Mem0 server + WeKnora 数据模型对齐                      | 3–5 天 |

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
- **全量绑定工具后 prompt token 上升**。`reason_ontology` 与
  `reason_rules` 的描述已接近 DSH 判定「该拆进参数」的长度，
  §4.3 重写时压缩这两条。
- **deepagents 的 `LocalShellBackend` 不可直接用于生产**（官方明确列为不适用）。
  §6.3 的自包装层是本 Phase 的主要工作量，不是 deepagents 本身。
- **Mem0 的 `baseURL` 复用是 Phase 5 的 go/no-go 闸门**（§7.6 第 3 步）。
  通过则零改造接入；不通过才需要扩展 `BUNDLED_*_PROVIDERS` 并重建镜像，
  那与 ADR-0018「配置只由 env 提供」有摩擦，届时需单独裁决。
