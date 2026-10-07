# Assistant 意图路由改由大模型识别 + 检索链路缺陷修复计划

Created: 2026-10-07
Revised: 2026-10-07（按用户口径修正：**关键词机制整体退役**，不保留规则回退与灰度开关；LLM 故障的降级语义改为**绑定全部可用工具**）
状态: **P0–P2 已落地**（2026-10-07，见 `docs/logs/migration-log/2026-10-07.md`）。**剩余只有运维项**：F3 图谱重导（P3）、以及把本批改动发一个新镜像并部署。F4 的安全组已验证生效（主站 → `10428` = 200，trace 已自行恢复）。本文件在运维项完成前仍是执行源。
定位: 把 assistant 的**每轮工具预筛选**从 455 行关键词正则换成**大模型工具选择**（复用现有 `AI_LANGUAGE_*` 运行时，不新增 sidecar、不微调、不改图拓扑），并修掉本次生产彻查发现的 8 个缺陷。前置评估见 `review/laya-intent-eval-2026-10-05.md`（结论：24 个工具已超 Laya 零样本上限，纯替换会降级；LLM 直接选工具是唯一零基础设施增量的路线）。

> 落地与计划的差异（以实际实现为准）：
>
> - F7（消息重复）不是"改 reducer"，而是把消息装配整体挪到 `classify_intent`（`prepare_context` 只备记忆块），因此 `messages` 仍是 append reducer。
> - 降级不强制 `mixed`，而是**从绑定的工具集派生** intent：生产候选集恒含知识类与写入类，自然落成 `mixed` → 通用 agent 节点；窄候选集（如只剩写入工具）仍会走它该走的子图（否则会跳过写入的图内复核）。
> - 评测集落在 `src/modules/assistant/agent/runtime/intent-eval.fixture.ts`（vitest 的 root 是 `src`，放 `test/fixtures` 不会被单测跑到），只做形状校验 + 三条事故样本的基线留档；调模型的人工评测不进 CI。
> - 候选集钳制在**分类器与图节点两处**都做（分类器记 warn，节点作为契约自守）。

---

## 〇、一页结论：生产实测（2026-10-07，三台机器只读取证）

| #   | 现象                                   | 实测根因                                                                                                                                                                    | 定性             |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| C1  | 「不开放 LightRAG 查询工具」           | **配置没问题**：线上 `LIGHTRAG_ENABLED=true`、key 已配（64 字符）、`lucent-lightrag-1` Up 5 天 healthy、`/health`=200；语料 200 文档 / 724 chunk / 6,905 实体 / 14,979 关系 | 用户前提需修正   |
| C2  | 同上，真正原因                         | **中文那轮工具被绑定、被写进提示词，模型自己没调用**，却对用户宣称"未开放"；英文那轮是真的没被路由选中                                                                      | 路由 + 模型行为  |
| C3  | 「查了英文显示零个，换成英文还是零个」 | `search_drugbank_passages` / `resolve_drugbank_entity` 读的是 `context.userMessage`（用户原句）而非模型给的 `toolArgs`                                                      | **代码 bug**     |
| C4  | 同上，第二条独立原因                   | 线上图谱是**从本地 dev 库导出的 895 味药子图**，地塞米松与布洛芬都不在图中（触碰边 = 0）                                                                                    | 数据覆盖         |
| C5  | 阿里云 10428 打开后仍无 trace          | 主站到 `47.94.95.42:10428` **TCP 不通**（9428 通）；VictoriaTraces 后端本身正常                                                                                             | 安全组漏放行     |
| C6  | 路由层既有缺陷                         | 注释引用的 `EXPLICIT_RULE_REASONING_RULES` 全仓不存在；`reason_over_rules` 与直读同时命中时排序与注释承诺相反                                                               | 随关键词退役消解 |
| C7  | 每轮消息被重复追加（潜在）             | `messages` 是 append reducer（`state.ts:116-118`），`classify_intent` 想"改写 messages[0]"实际是**追加**一遍 System+User                                                    | 代码缺陷         |
| C8  | 工具调用 id 不对齐（潜在）             | `AssistantToolCall` 丢掉 provider 的 `id`（`nodes.ts:57-60`），`nodes.ts:99` 自造 `call_${index}`；执行前按 policy 过滤还会丢调用                                           | 代码缺陷         |

### C1/C2 的铁证：生产库 `assistant_messages.used_tools`

| 时间(UTC) | 用户消息                                          | `used_tools`                                          |
| --------- | ------------------------------------------------- | ----------------------------------------------------- |
| 09:34:32  | 你好，你有什么能力可以帮我查药品吗?               | `[]`（零调用）                                        |
| 11:33:54  | 查询地塞米松和布洛芬的相互作用，以及哪种药物不能… | `["reason_over_ontology","search_drugbank_passages"]` |
| 11:35:46  | Search for the interaction between dexamethasone… | 同上 ×2 组合（循环重试）                              |

同期用仓库自己的 vitest 跑**线上同一份路由代码**（部署 tag `dc9e3d15` 与 HEAD 在这三个文件上逐字节相同），三条消息实际绑定的工具集：

| 消息                                | intent    | 绑定工具                                                                                                                               |
| ----------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 你好，你有什么能力可以帮我查药品吗? | read_data | `get_current_medicines`（仅 1 个）                                                                                                     |
| 查询地塞米松和布洛芬的相互作用…     | mixed     | `search_cn_medicine_knowledge`, `resolve_drugbank_entity`, `reason_over_ontology`, `search_drugbank_passages`, `get_current_medicines` |
| Search for the interaction between… | mixed     | 同上但**不含** `search_cn_medicine_knowledge`                                                                                          |

⇒ 中文轮：LightRAG 工具在候选集里、在提示词 `Allowed tools in this run:` 行里（`prompts/system.prompt.ts:31`），模型**一次都没调**，然后把它说成产品级不可用。
⇒ 英文轮：`search_cn_medicine_knowledge` 的英文规则（`tool-keyword-rules.ts:191-226`）不匹配 "the interaction between X and Y"，所以模型说 "not permitted here" 是准确的。

用 app 容器内的 key 直接打 sidecar：`POST /query` 返回带引用（`[4]` 双氯芬酸+皮质激素→胃肠道不良反应↑、`[6]`、`[9]`）的中文答案——**只要模型调了，这一轮就能答出来**。

### C3 的 SQL 级复现

```sql
name ILIKE '%<整句用户原话>%'  → 中文句 0 行、英文句 0 行
name ILIKE '%ibuprofen%'       → 3 行
name ILIKE '%dexamethasone%'   → 3 行（DB01234 / DB14649 / DB19168）
```

两层缺陷：①整句当 LIKE 模式必然 0 行；②即便传裸药名，`contains + take:5` 命中多个（原药 + 乙酸酯 + 棕榈酸酯）→ `coverage: partial` → `resolveSingleDrugbankId` 仍返回 `null`（`tools/drugbank/search.service.ts:133-153`）。单测没拦住，是因为它们把裸药名当 `userMessage` 且 mock 了 Prisma（`entity-resolve.service.spec.ts:21`、`search.service.spec.ts:94`）。

### C5 的链路证据

```
主站 → 47.94.95.42:9428/health  = 200
主站 → 47.94.95.42:8428/health  = 000   （按设计只放行运维 IP）
主站 → 47.94.95.42:3001/health  = 000   （同上）
主站 → 47.94.95.42:10428/health = 000   ← 应放行主站出口 IP，实际被丢包
/dev/tcp/47.94.95.42/10428 → FAIL       /dev/tcp/47.94.95.42/9428 → OK
```

VictoriaTraces 容器日志里主站最后一次到达是 `2026-10-03T10:15:56Z`（`/insert/opentelemetry/v1/traces/v1/metrics` → unsupported path），与最后一条可查 span `10:15:43Z` 同刻；此后近 3 天零请求。后端可写入可查询（合成 span 能查到），**不需要重建容器**。

---

## 一、目标与非目标

**目标**

1. **关键词路由整体退役**：删除 `agent/runtime/tool-keyword-rules.ts`（455 行）与 `router.ts` 里的 `selectRelevantToolsForMessage`；每轮工具集由大模型选择，`intent` 由确定性分桶从工具集导出。
2. **降级语义 = 工具全开**：LLM 不可用 / 熔断 / 超时 / 结构化输出非法时，绑定**全部可用工具**（context 许可 ∩ 已实现 ∩ sidecar 可用）并强制 `intent = 'mixed'`，走通用 `agent` 节点。不保留规则回退、不设灰度开关。
3. 修掉 C3、C4、C5、C7、C8 以及 C1/C2 暴露的两处语义问题（静默非法参数信封、"本轮工具集"被说成"产品能力"）。
4. 建立**可测量的路由质量门禁**：标注评测集（退役后它是唯一保留旧行为作为 ground truth 的地方）+ 单测基线。

**非目标**

- 不引入 Laya / 新 sidecar / 模型微调（见 `review/laya-intent-eval-2026-10-05.md` §五、§六）。
- 不改 LangGraph 拓扑：`intent` 的 5 个字面量与 4 条条件边（`graph.ts:259-275`）保持不变。
- 不改写入链路：`propose_*` 仍是草稿，真写只发生在客户端确认后（`services/proposal-confirm.service.ts`）。

---

## 二、架构决策

### 2.1 现状

| 层           | 位置                                                                                         | 本质                                 |
| ------------ | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| A 工具预筛选 | `agent/runtime/router.ts:32-248` + `tool-keyword-rules.ts`（455 行 / 24 工具 × 5–35 条正则） | 纯正则，决定**把哪些工具暴露给 LLM** |
| B 意图分桶   | `agent/runtime/classify.ts:56-101`                                                           | 纯规则，把 A 的结果分进 5 个 intent  |

`classify_intent`（`graph.ts:220-235`）是全图唯一的纯规则节点，且唯一带 `cachePolicy`（TTL 3600s，`graph.ts:49,234`）。

### 2.2 决策

**一次结构化 LLM 调用只产出"工具清单"**（`tools: AssistantToolName[]`），`intent` 由纯分桶函数从该清单导出（把 `classify.ts:75-101` 抽成导出函数 `deriveIntent(tools)`）：

- 保留"写提案优先于其辅助读"（`classify.ts:88-99`）这类桶间裁决；
- `relevantTools` 与 `intent` 天然自洽，无需额外一致性校验；
- **不再有**基于关键词的 `WRITE_INTENT_RULES` 兜底（`classify.ts:65-73` 随之删除）。

**故障降级：工具全开。**

```
LLM 失败 → relevantTools = candidateTools（全部可用工具）
         → intent = 'mixed'（强制走通用 agent 节点，不做"猜意图"）
```

- 为什么不回退关键词：口径已定，规则表整体删除，"回退到关键词"不再是一个可维护的选项。
- 为什么强制 `mixed`：候选集恒含知识类与写入类工具（它们的 `requiredSources` 都是 `[]`），`deriveIntent` 正常算也会得到 `mixed`；**强制它**是为了让降级路径恒定走通用 `agent` 节点，而不是被判进某个带专用校验的子图，行为更可预期。
- 候选集为空（如 `assistantEnabled=false`，或全部工具不可用）仍走 `nodes.ts` 的 `no_match` 语义。
- **降级必须可观测、可告警**：每次降级记 warn + `assistant_intent_routing_total{source="degraded_all_tools"}`；正常路径是 `source="llm"`。降级应是罕见异常态，不是常态化兜底。

| 选项                              | 取舍                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| **LLM 选工具 + 降级全开（采纳）** | 零新增基础设施、零新增进程、能理解自然语言问法；代价是每轮多一次几百 ms 往返（10s 预算内） |
| 保留关键词回退                    | 与"完全退役"口径冲突，且规则表要跟着工具数一起维护                                         |
| Laya / 微调分类器                 | 24 工具超零样本上限、需标注 + 训练 + 新进程                                                |
| 24 个工具全绑定、让 agent 自选    | 等同"永久降级"：丢掉预筛选（成本与误调用上升），`no_match` 快速通道失效                    |

### 2.3 退役方式与安全网

- **删除**：`agent/runtime/tool-keyword-rules.ts`、`router.ts` 的 `selectRelevantToolsForMessage`、`classify.ts` 的关键词依赖与 `classifyIntent`。
- **保留并搬迁**：`selectAllowedToolsForContextSources`（这是**权限映射**不是路由规则）移到 `agent/runtime/tool-permissions.ts`，`router.ts` 删除；调用方 `graph.ts:180-184`、`services/policy.service.ts` 同步改导入。
- **保留在代码的确定性不变量**：权限三层（§3.3）、检索工具依赖序（`router.ts:56-78` 的优先级 + `subgraphs/knowledge.ts:18-40`）、`MAX_TOOL_LOOPS` 与条件边、写路径"只产草稿 + 确认"。
- **风险与安全网**：删掉关键词后，"把写请求降级成闲聊"不再有规则兜底。三重缓解：①提示词硬规则（写请求必须选 `propose_*`）；②降级时工具全开，写入路径仍可达；③真实写入仍由草稿 + 客户端确认把守，误路由不会落库。评测集**必须含写类样本**，把该类失误计为路由失败并设门槛。

---

## 三、详细设计：LLM 工具选择

### 3.1 新增 `AssistantIntentClassifierService`

文件：`src/modules/assistant/agent/runtime/intent-classifier.service.ts`（+ 提示词 `prompts/intent-router.prompt.ts`、schema `schemas/intent-routing.schema.ts`）

- 继承 `BaseLlmGeneratorService<TContext, TPromptCopy, TOutput>`（`src/common/llm/generators/base-llm-generator.service.ts:47-53`），实现 `schema` / `options` / `modelRole` / `buildSystemPrompt()` / `buildUserPrompt()`。
- 抽象 API（已核实）：
  - `options: { toolName, streamName }`（`:33-38`）→ `toolName: 'AssistantToolSelection'`、`streamName: 'Assistant tool selection'`（进入 span `llm.<streamName>.generate` 与所有错误文案）。
  - `MODEL_OPTIONS = { timeout: AI_MODEL_TIMEOUT_MS(10_000), temperature: 0.2, maxRetries: 0 }`（`:25-29`）——`maxRetries: 0` 是刻意的，重试交给 `withLlmRetry`（3 次 / 800ms 指数，`src/common/llm/retry/llm-retry.helper.ts:60-64`）。
  - 结构化输出走 `.withStructuredOutput(schema, { name: toolName, method: 'functionCalling', strict: true })`（`:324-332`）。
  - `generate()` 失败时抛 `ServiceUnavailableException`（`:95-100`）并已记 `recordFailure()` + 指标 —— **节点必须 catch 后进入"工具全开"降级**。
  - 角色守卫沿惯例重命名：`hasLanguageModel()` → `return this.hasAnalysisModel()`（参考 `tools/ontology/cypher-generator.service.ts:51-53` 的注释说明该错名）。
- `modelRole: 'language'`。理由：它已是"文本理解 → 结构化输出"的角色（Cypher 生成同形），且**无需任何新增环境变量**；若实测延迟/质量不达标，P2b 再升级为独立角色（届时要动 7 个源文件 + 2 个 env 示例 + env 文档 + 2 个 spec，参考提交 `56324fbc` 的 AI_THINKING 模式；`src/llm-runtime/llm-runtime.service.ts:42-49` 的已配置角色列表是硬编码的，最容易漏）。
- zod schema：`tools: z.array(z.enum(ASSISTANT_TOOL_NAMES)).max(8)`（**不含 intent**，见 §2.2），可选 `reason` 仅供日志/评测。
- 提示词四段：①候选工具清单（名称 + `TOOL_DESCRIPTIONS` 文案，`tools/shared/tool-definitions.ts:176-232`）+ "只能从清单里选"；②原关键词表的**语义版领域规则**（§3.4）；③写请求必须选 `propose_*`；④"不确定就少选"。

### 3.2 图节点改造（`agent/runtime/graph.ts:220-235`）

```
classify_intent（改 async）：
  1) candidateTools = selectAllowedToolsForContextSources(state.enabledContextSources)
                      ∩ implemented ∩ sidecar 可用（retrievalAvailable / oagAvailable）
  2) try:
       llmTools = await deps.classifyTools(state.userMessage, candidateTools)
       relevantTools = llmTools ∩ candidateTools        // 越权/幻觉工具名丢弃并 warn
       intent = relevantTools.length ? deriveIntent(relevantTools) : 'simple_chat'
       source = 'llm'
     catch (角色未配置 / 熔断 / 超时 / schema 非法):
       relevantTools = candidateTools                   // 工具全开
       intent = candidateTools.length ? 'mixed' : 'simple_chat'
       source = 'degraded_all_tools'; logger.warn(原因)
  3) systemPrompt = selectSystemPrompt(deps, intent, relevantTools)（逻辑不变）
     写回 { intent, relevantTools, messages }
```

要点：

- **第 1 步是本次事故的直接修复**：今天绑定用的是 `selectAllowedToolsForContextSources(...)`（`graph.ts:180-184`，已核实），**不含 sidecar 可用性过滤**，所以 LightRAG 关闭时工具照样进候选集与提示词，模型只能在调用后才撞上 "unavailable"。注意 `toolCapabilities[].enabled`（`services/policy.service.ts:70-75`）虽已包含 `retrievalAvailable`/`oagAvailable`，但它**只喂客户端能力响应**（`services/core.service.ts:55`），请求路径上一个门都不把。因此需要把 enabled 集从 `stream-orchestrator.service.ts` 经 `runtime.service.ts` 传进图的 deps（`graph.ts:92-117`）。
- **端口化以便测试**：`buildAssistantRuntimeGraph` 增加可选 dep `classifyTools?`；**测试必须显式注入 fake**（不注入即"未配置 → 降级全开"，因此不存在隐式关键词路径）。
- **节点必须保持幂等**（缓存键来自节点读到的 state，含 `userId` 与 messages，TTL 3600s，跨用户不会串）。**降级结果不写缓存**（否则一次故障会被记忆一小时）。
- **`retryPolicy: false`**：图级默认 `retryPolicy.maxAttempts: 3`（`graph.ts:298-305`）与 `withLlmRetry` 的 3 次会叠成最多 9 次模型调用，路由节点必须显式关掉图级重试。
- 超时：节点受 `ASSISTANT_NODE_TIMEOUT_MS = 80_000`（`graph.ts:68-75`）约束，多一次 10s 调用仍在预算内。

### 3.3 权限门禁（保持确定性，不交给模型）

| 层                | 位置                                                                              | 作用                                              | 本次变化                                               |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| 用户 context 开关 | `selectAllowedToolsForContextSources`（移至 `agent/runtime/tool-permissions.ts`） | 按 `ASSISTANT_TOOL_SOURCE_MAP` 过滤               | 不变，改为喂给 LLM 而非直接绑定                        |
| sidecar 可用性    | `policy.service.ts:65-69`（`retrievalReady`/`oagReady`）                          | LightRAG/Semantica 关闭时对应工具 `enabled=false` | **新增**：plumb 进图并参与候选集（含降级全开时的上限） |
| 执行期二次过滤    | `stream-orchestrator.service.ts:128-133`                                          | 丢弃越权工具调用                                  | 见 C8：改为"每个请求都回一个结果信封"                  |
| 工具名白名单      | 新增：LLM 输出 ∩ 候选集                                                           | 防提示注入 / 幻觉工具名                           | **新增**                                               |

"工具全开"指**全开到候选集为止**：`candidateTools` 仍是硬上限，降级不越过用户 context 开关与 sidecar 可用性。写路径的"绝不自动写"由 `propose_*` 只产草稿 + 确认端点保证，**不依赖路由**。

### 3.4 关键词规则退役清单（逐条给去向）

| 现规则（位置）                                                    | 去向                                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `EXPLICIT_CN_PRODUCT_RULES` 短路（`router.ts:87-95`）             | 迁移为提示词规则（国药准字/批准文号/厂家/规格 → CN 产品工具）；不再有代码短路                         |
| 历史摘要专路由（`:105-135`）                                      | 迁移为提示词规则                                                                                      |
| 写提案优先级（`:137-165`）                                        | 提示词规则（删 > 设置 > 改 > 增）+ 代码不变量：`deriveIntent` 的"写优先于辅助读"；写入仍走草稿 + HITL |
| 空结果 + 写意图（`classify.ts:65-73`）                            | **删除**；由提示词硬规则 + 评测集门槛补偿（§2.3 风险）                                                |
| 检索工具排序（`router.ts:56-78`、`subgraphs/knowledge.ts:18-40`） | **保留在代码**（依赖链不是意图）：`sortRetrievalTools` 随 `router.ts` 一并搬迁或内联到 `knowledge.ts` |
| 范围回退（`:167-177`）                                            | 迁移为提示词规则                                                                                      |
| 兜底 `return []`（`:247`）                                        | LLM 判"都不需要工具" → simple_chat（语义不变）                                                        |
| `reason_over_rules` vs 直读（C6）                                 | 随文件删除消解；"推导优先于直读"写进提示词，知识子图排序保持                                          |

### 3.5 提示词护栏（修 C2 的表述层）

`prompts/system.prompt.ts` 目前只有 `buildSimpleChatSystemPrompt`（`:132-139`）带"不要暗示本产品没有这些工具"的护栏。把同一约束补进 `buildAssistantSystemPrompt` / `buildReadSystemPrompt` / `buildWriteSystemPrompt` / `buildKnowledgeSystemPrompt`，并明确"`Allowed tools in this run` 是本轮路由结果，不是产品能力边界"。

### 3.6 观测（本次排查只能翻库，必须补）

- 每次工具执行打结构化 info 日志：`tool` / `coverage.status` / `durationMs` / `disabledReason?`。
- 新增 counter：`assistant_tool_executions_total{tool,outcome}`、`assistant_tool_empty_total{tool,reason_class}`、`assistant_intent_routing_total{source=llm|degraded_all_tools,intent}`、`assistant_tool_selection_latency_seconds`。
- **降级要能告警**：`degraded_all_tools` 应为 0 或极低；持续非 0 说明模型角色没配好或熔断常开。
- 目的：下次"模型没调工具"或"检索恒空"能在 Grafana 一眼看到，而不是查 `assistant_messages.used_tools`。

---

## 四、检索链路与其他缺陷修复

### F1（P1）DrugBank 作用域读错字段 —— C3

- `tools/drugbank/entity-resolve.service.ts:22`、`tools/drugbank/search.service.ts:36,47,133`：改为**优先 `context.toolArgs['query']`**、回退 `userMessage`。
- 消歧：确定性排序 —— 精确名匹配 → 名称更短者 → `state='approved'`；仅当无法唯一确定时返回 `partial` + `ambiguities`，提示模型用 `drugbankId` 重试。
- 验收：新增"`userMessage` 是整句 + `toolArgs.query='ibuprofen'` → 唯一 `DB01050`"用例。

### F2（P0）LightRAG 静默非法参数 + `source` 无默认值

- `tools/retrieval/knowledge.service.ts:197-204`：`source` 缺失默认 `leaflet`；确属非法才拒绝，并 `logger.warn`（当前返回 `verifiability:'unavailable'` 且无日志，模型读成"工具不可用"）。

### F3（P3，运维）semantica 图覆盖 —— C4

- 根因：`semantica-service/scripts/export_subgraph.py:22` 的 `SOURCE_DSN` 指向**本地 dev 库**（127.0.0.1:15432），范围是 20 个 ATC level-4 前缀 + 12 个 anchor（`:28-64`）；已被 `deploy-secrets/README.md`「坑 7」记录。
- 改法：`SOURCE_DSN` 参数化（`--dsn`）→ 按生产库重跑导出 → 重新灌 Neo4j（`semantica-service/scripts/load_graph_neo4j.py`，实测约 16 分钟）。
- 验收：`/health` 的 `label_counts.Drug` 显著 > 895；`DB01234`/`DB01050` 入图且查到 INTERACTS_WITH 边。回退：保留旧图 volume 备份。

### F4（P0）trace 断流 —— C5

- 阿里云安全组为 `10428` **新增**主站出口 IP `122.9.146.162/32`（与 9428 现有规则对齐），**保留**运维 IP 规则。
- 主站 `.env` 补 `OTEL_METRICS_EXPORTER=none`：`src/tracing.ts:50-58` 的 `NodeSDK` 读该变量，默认 `otlp`，导致每分钟往 traces 路径 + `/v1/metrics` 打一条 unsupported 请求。
- 验收：主站 `curl http://47.94.95.42:10428/health` = 200；按 `trace_id` 能查到新 span。

### F5（P0）`search_drugbank_passages` 的 empty/unavailable 语义

- `tools/drugbank/search.service.ts:49-62`：向量库缺失 → `verifiability:'unavailable'`；作用域未解析 → `empty` 但 `reason` 指明是**作用域/参数**问题（与 `tools/retrieval/knowledge.service.ts:307-313` 的纪律对齐）。

### F6（P0）`reason_over_rules` 幽灵引用与排序 —— C6

- `tool-keyword-rules.ts:306` 引用的 `EXPLICIT_RULE_REASONING_RULES` 全仓不存在。**随该文件删除一并消解**；"推导类问法优先 `reason_over_rules`、直读用 `reason_over_ontology`"改写进路由提示词，并保持知识子图排序（`subgraphs/knowledge.ts:18-40`）不变。

### F7（P1）`messages` append reducer 导致每轮消息重复 —— C7

- `state.ts:116-118` 的 `messages` 是 append reducer，而 `classify_intent` 写回 `[new SystemMessage, ...state.messages.slice(1)]`，实际是**追加**，同一轮出现两条 System + 两条用户消息（已用独立 LangGraph 复现；无 spec 覆盖）。
- 改法二选一，**必须在实现时明确取舍**：①节点改为"只替换首条 System"（reducer 语义安全的写法）；②或在图入口不再预置 System。倾向 ①，并补一条断言消息数组长度/内容的 spec。

### F8（P1）工具调用 id 丢失与位置错配 —— C8

- `types/assistant.types.ts:241-244` 的 `AssistantToolCall` 只有 `{name,args}`，provider 的 `tool_calls[].id` 在 `nodes.ts:57-60`（已核实）被丢掉；`nodes.ts:96-103`（已核实）用 `call_${index}` 造 `ToolMessage.tool_call_id`。LangChain 原样透传，严格 OpenAI 兼容服务会 400（非 429/5xx，**不重试**）；宽松服务位置配对，所以"看起来能用"。所有 fixture 恰好都用 `id: 'call_0'`，把缺陷掩盖了。
- 第二个独立错配：`stream-orchestrator.service.ts:128-133` 先按 policy 过滤再执行，`results.length` 可能小于 `toolCalls.length`，而 `nodes.ts` 按位置归属结果。
- 改法：`AssistantToolCall` 带上 `id` 并在 `nodes.ts:99` 使用（仅对无 id 调用保留合成回退）；执行器对**每个**请求都回一个结果（未授权也回一个"未许可"信封），消除位置算术。

---

## 五、测试与验收

**策略**：分类器是**必须显式注入的可选 dep**；不注入 = 未配置 = 降级全开。没有关键词路径可测，因此现有路由测试**要么改写成"降级全开"的断言，要么删除**，路由质量由评测集承接。

| 层       | 内容                                                                                                                                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 删除     | `agent/runtime/router.spec.ts`（:56-303 全为关键词断言）、`classify.spec.ts`（:27-119）随实现删除                                                                                                                                                                                                  |
| 改写     | `graph.spec.ts`：直接 router 断言（`:28-69,71-99,101-125,127-149`）删除；端到端 intent 断言（`:174-175,203-204,264-270,333,389-394`）改为注入 fake 分类器；补"未注入分类器 → 工具全开 + intent=mixed + 降级"与"分类器抛错 → 同上"（`:181-210` 的 `bindTools` 断言按新语义调整）                    |
| 新增单测 | `intent-classifier.service.spec.ts`（through Test 子类，参考 `base-llm-generator.service.spec.ts:28-47`）：正常 / schema 非法 / 抛 `ServiceUnavailableException` / 返回越权工具名；`deriveIntent` 纯函数单测（承接旧 `classify.spec.ts` 的意图期望）                                               |
| 子图夹具 | `subgraphs/{read,write,knowledge}.spec.ts` 的 `relevantTools` 手工构造不受影响                                                                                                                                                                                                                     |
| 评测集   | 新建 `test/fixtures/assistant-intent-eval.ts`（40–60 条真实问句，中英各半，含本次 3 条 + **写类样本** + 国药准字键查 + 多意图/边界），数据来自生产 `assistant_messages` 只读导出；门槛：3 条回归样本全对、写类样本零降级为闲聊、总体不低于旧关键词实现（基线用同一评测集在当前 HEAD 上跑出并留存） |
| E2E      | 补一条：知识类问句必须实际调用 retrieval 工具（断言 SSE `toolDetails[].name`）。现状 e2e 不覆盖意图（`test/e2e/assistant/assistant.e2e-spec.ts` 无相关断言）                                                                                                                                       |
| 生产验收 | ①`capabilities.tools[].enabled` 与 `used_tools` 一致；②同一条中文问句 `used_tools` 含 `search_cn_medicine_knowledge` 且 coverage 非空；③"ibuprofen mechanism"返回 passages；④`assistant_intent_routing_total{source="degraded_all_tools"}` 为 0；⑤Grafana 可见 trace 与新增指标                    |

必跑（`Lucent/`）：`pnpm lint:check`、`pnpm typecheck`、`pnpm build`、`pnpm test:ci`、`pnpm docs:verify`、`pnpm docs:links`。**`pnpm export:openapi` 不需要**（不动 controller/DTO）—— 除非把路由状态暴露为新的 capabilities 字段。

---

## 六、分阶段落地与回退

| 阶段 | 内容                                                                                                       | 风险                                             | 回退                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| P0   | F2、F4、F5 + §3.5 提示词护栏（F6 随 P2 删除关键词表一并消解，P0 不再单独动它）                             | 低（无行为重写）                                 | 逐项 revert 单文件 / 恢复安全组规则                                                                                 |
| P1   | F1、F7、F8 + 单测                                                                                          | 中低（F7/F8 触及消息与工具结果装配）             | revert 对应文件；F8 保留合成 id 回退即可兼容                                                                        |
| P2   | **关键词退役 + LLM 工具选择**（§3.1–3.6，含删除 3 文件 / 搬迁 1 函数、评测集、降级全开）；一次硬切，无开关 | 中高：删掉规则兜底后路由质量完全依赖模型与提示词 | 只能回滚镜像（`LUCENT_IMAGE` 改回上一 tag）→ **上线前评测集必须达标**，上线后首日盯 `degraded_all_tools` 与写类样本 |
| P3   | F3 图谱重导（运维；期间可临时 `SEMANTICA_ENABLED=false`，让语义显示"推理暂不可用"而非"无此断言"）          | 中                                               | 回挂旧图 volume                                                                                                     |

每阶段代码变更向 `docs/logs/migration-log/YYYY-MM-DD.md` 追加当日条目（append-only）；同步 `src/modules/assistant/README.md`（其现有表述"纯规则关键词路由，无 LLM"将变为不成立）。**不新立 ADR**（2026-10-07 裁决）：本次替换的是既有 intent/工具契约的实现方式，`intent` 集合、工具集语义、权限门禁与图拓扑都未变。

---

## 七、风险与未决

1. **P2 是硬切**：没有规则回退与灰度开关，回退手段只有回滚镜像 → 评测集门槛与上线前手工验证是唯一防线。
2. **写请求被降级成闲聊**：`classify.ts:65-73` 的规则兜底随关键词一起删除；靠提示词硬规则 + 评测集门槛 + 草稿确认三层补偿，**必须在评测集里量化**。
3. **降级常态化**：`AI_LANGUAGE_*` 未配置时每轮都会"工具全开"（可用但成本高）。`degraded_all_tools` 必须告警；部署自检清单要含"角色已配置"。
4. **重试放大**：图级 3 次 × `withLlmRetry` 3 次 = 最多 9 次模型调用，必须在新节点上 `retryPolicy: false`。
5. **延迟/成本**：每轮多一次结构化调用；用 `language` 小模型 + 节点缓存（键含 userId，per-user 记忆化）缓解；上线后看 `assistant_tool_selection_latency_seconds` p95。
6. **C7 的取舍**：是"保持现状不改"还是"顺手修掉消息重复"，需在 P1 明确；修了要检查对 prompt 缓存与模型行为的影响。
7. **F3 期间英文侧**：图重建时可能返回空，建议低峰执行并临时关闭 `SEMANTICA_ENABLED`。
8. **安全组**：10428 要**新增**主站 `/32`，不要替换运维 IP 规则。
9. **并行写者**：本仓当前有另一个会话在提交（HEAD 已从 `4c87ae77` 前进到 `f3e068e5`），P2 触及文件多，开工前确认对方已到停点。
10. **未决**：是否把路由提升为独立模型角色（`AI_ROUTER_*`）；评测集规模与标注口径；候选集很窄（只剩知识类工具）时是否也要强制 `mixed`。

---

## 八、交付物清单（预计改动文件）

- **新增**：`src/modules/assistant/agent/runtime/intent-classifier.service.ts`、`.../intent-classifier.service.spec.ts`、`src/modules/assistant/agent/runtime/tool-permissions.ts`、`src/modules/assistant/prompts/intent-router.prompt.ts`、`src/modules/assistant/schemas/intent-routing.schema.ts`、`test/fixtures/assistant-intent-eval.ts`
- **删除**：`src/modules/assistant/agent/runtime/tool-keyword-rules.ts`、`.../router.ts`、`.../router.spec.ts`、`.../classify.spec.ts`
- **修改**：`agent/runtime/{graph.ts,classify.ts,nodes.ts,state.ts}`、`agent/runtime.service.ts`、`assistant.module.ts`、`prompts/system.prompt.ts`、`services/{policy.service.ts,stream-orchestrator.service.ts}`、`types/assistant.types.ts`、`tools/drugbank/{entity-resolve.service.ts,search.service.ts}`、`tools/retrieval/knowledge.service.ts`、`subgraphs/knowledge.ts`（排序函数内联）、`agent/runtime/graph.spec.ts`、`src/modules/assistant/README.md`
- **仅当新增模型角色**：`src/config/env/{env-keys.enum.ts,environment.validation.ts}`、`src/config/services/llm.config.ts`、`src/common/llm/llm-runtime.port.ts`、`src/llm-runtime/llm-runtime.service.ts`、`.env.{development,production}.example`、`docs/reference/environment-variables.md` 及两个对应 spec（参考 `56324fbc`）
- **运维（非仓库）**：`semantica-service/scripts/export_subgraph.py`（`--dsn` 参数化）、主站 `.env` 增 `OTEL_METRICS_EXPORTER=none`、阿里云安全组 `10428` 规则

---

## 附录 A：本次取证的只读命令（可复核）

```bash
# 主站（华为云 122.9.146.162）
grep -E '^(LIGHTRAG_|OTEL_|SEMANTICA_)' /opt/lucent/.env
docker ps --format '{{.Names}}|{{.Status}}'
docker exec lucent-app-1 printenv | grep -E '^(LIGHTRAG_ENABLED|OTEL_ENABLED|OTEL_EXPORTER_OTLP_ENDPOINT|SEMANTICA_ENABLED)'
docker exec lucent-postgres-1 psql -U lucent -d lucent -c \
  "select created_at, role, used_tools from assistant_messages order by created_at desc limit 10;"
docker exec lucent-postgres-1 psql -U lucent -d lightrag -Atc \
  "select 'docs='||(select count(*) from lightrag_doc_full)
        ||' chunks='||(select count(*) from lightrag_vdb_chunks_text_embedding_v4_768d)
        ||' entities='||(select count(*) from lightrag_vdb_entity_text_embedding_v4_768d);"
curl -s -m 6 -o /dev/null -w '%{http_code}\n' http://47.94.95.42:10428/health   # 修复后期望 200

# 图库机（腾讯云 106.52.105.88）
curl -s http://127.0.0.1:8099/health     # stats.label_counts.Drug 期望显著 > 895
```

## 附录 B：相关既有文档

- 前置评估：`review/laya-intent-eval-2026-10-05.md`
- 模块边界：`src/modules/assistant/README.md`
- 检索侧运维事实：`deploy-secrets/README.md`（「坑 7」）、`Lucent/docs/reference/deployment.md`
- 计划目录约定：`plans/README.md`
