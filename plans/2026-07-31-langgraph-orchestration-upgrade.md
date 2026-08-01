# LangGraph 编排升级计划：条件边 · 路由 · 子图 · 循环

## 背景

当前 assistant runtime 的 LangGraph 是一个 4 节点扁平结构：

```
START → prepare_context → agent ↔ tools → respond → END
```

存在以下结构性问题：

### P1: 路由逻辑完全旁路

`router.ts` 中的 `selectRelevantToolsForMessage` 实现了 244 行精细的关键词路由
（区分读记录、写意图、摘要查询、药品知识、睡眠等），但**该函数在图中从未被调用**。
图中 `prepare_context` 只调用了 `selectAllowedToolsForContextSources`（按 context
source 权限过滤），然后把所有 allowed tools 一次性绑给 LLM。关键词路由仅存在于
测试中（`graph.spec.ts` 和 `router.spec.ts`），与实际运行图脱节。

**后果**：LLM 每次都收到全部 allowed tools（最多 21 个），增加 token 消耗、降低
工具选择准确率、增大误调用风险。

### P2: 无意图分类——所有消息走同一路径

用户说"你好"和"帮我查一下最近 7 天的记录并对比上次月报"走完全相同的节点序列。
简单问候不需要绑定工具，但当前图仍会把全部 allowed tools 绑给 LLM 再 invoke，
浪费一次 LLM 调用。

### P3: 无子图——读/写/知识检索混在同一 agent 节点

21 个工具覆盖三类语义截然不同的操作：

| 类别         | 工具                                                                                                                                             | 特点                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 用户数据读取 | `get_today_records`, `get_records_by_*`, `get_*_summary_*`, `get_user_profile`, `get_current_medicines`                                          | 需要 context source 权限，结果是结构化 envelope                              |
| 写入提案     | `propose_create/update/delete_daily_record`, `propose_update_user_settings`                                                                      | 不写库，返回 confirmation draft                                              |
| 知识检索     | `search_cn_medicine_products`, `get_cn_medicine_detail`, `search_medicine_leaflets`, `search_medical_qa_corpus`, `resolve/get/search_drugbank_*` | RAG 向量检索，有跨工具依赖（如 leaflet 依赖 CN product detail 的 productId） |

三类工具的系统提示策略不同（读数据强调 coverage/confidence，写提案强调
"不写库只返回 draft"，知识检索强调证据来源区分），但当前用同一个
`buildAssistantSystemPrompt` 一把全塞进去。

### P4: 无工具结果校验——错误/空结果直接喂回 LLM

`tools` 节点执行后直接把 `ToolMessage` 追加到 `messages`，没有检查结果是否
包含错误、空数据、或需要消歧。LLM 可能基于空结果继续幻觉。

### P5: 无提前退出——简单查询仍走完整 agent 节点

当 `allowedTools` 为空或消息是纯闲聊时，`agent` 节点仍会尝试 `bindTools`
（虽然 `allowedTools.length === 0` 时提前返回 `no_match`，但该分支的结果
`finalContent: null` 导致 `core.service` 还要再调一次 `generateStream`——
相当于两趟 LLM 调用，而第一趟完全没有产出）。

### P6: 无流式集成

Graph 产出的 `finalContent` 是一次性 `invoke` 的结果，不是流式。`core.service`
需要判断是否有 `finalContent` 再决定走 `streamPreGeneratedContent` 还是
`generateStream`——两条路径在 graph 外分叉，图本身不感知流式。

---

## 设计决策

### D1: 引入 `classify_intent` 路由节点

新增一个轻量分类节点，**不调 LLM**，使用 `selectRelevantToolsForMessage`
（已有 244 行关键词规则）+ 简单启发式判断意图类别：

```typescript
type AssistantIntent =
  | 'simple_chat' // 无需工具的问候/闲聊
  | 'read_data' // 用户数据读取
  | 'write_proposal' // 写入提案
  | 'knowledge' // 药品/医学知识检索
  | 'mixed'; // 跨类别（如 "查一下最近记录并帮我记一条饮水"）
```

分类逻辑：

1. 调用 `selectRelevantToolsForMessage(userMessage, allowedTools)` 得到
   relevant tools（当前已有但未使用的路由逻辑）
2. 按 relevant tools 的前缀分类：
   - 空 + 无 `WRITE_INTENT_RULES` 匹配 → `simple_chat`
   - 仅 `get_*` → `read_data`
   - 包含 `propose_*` → `write_proposal`
   - 包含 `search_*` / `resolve_*` → `knowledge`
   - 混合 → `mixed`
3. 输出到 state: `intent`, `relevantTools`（缩小后的工具集）

**不调 LLM 的理由**：关键词路由已有充分测试覆盖（`router.spec.ts` 273 行），
且 `core.service` 外层的 `runConversation` 已有 LLM agent 调用。分类节点保持
纯规则，避免增加额外 LLM 调用延迟。

### D2: 按意图路由到不同子图

`classify_intent` 通过条件边路由到 4 个子图 + 1 条直通路径：

```
START → classify_intent
  ↓ (conditional edges)
  ├─ simple_chat  → respond → END
  ├─ read_data    → [read_subgraph]  → respond → END
  ├─ write_proposal → [write_subgraph] → respond → END
  ├─ knowledge    → [knowledge_subgraph] → respond → END
  └─ mixed        → agent（全量 relevantTools）→ respond → END   ← 修订：不拆子图
```

每个子图是独立的 `StateGraph`，有自己的 `agent` ↔ `tools` 循环，但共享
`AssistantRuntimeState`（通过 state schema 继承）。

### D3: 子图的差异化设计

#### `read_subgraph`（用户数据读取）

```
read_agent ↔ read_tools → read_validate
```

- **read_agent**: 只绑定 `relevantTools` 中的 `get_*` 工具，使用 read 专用
  system prompt（强调 coverage/confidence/ambiguities 字段）
- **read_tools**: 执行 read 工具，追加 ToolMessage
- **read_validate**: 检查工具结果中的 `coverage.status`：
  - `complete` → 允许 agent 继续或路由到 respond
  - `partial` → 在 ToolMessage 中追加提示"coverage is partial, acknowledge this"
  - `empty` → 设置 `stopReason: 'no_data'`，路由到 respond

#### `write_subgraph`（写入提案）

```
write_agent ↔ write_tools → write_validate
```

- **write_agent**: 只绑定 `propose_*` 工具，使用 write 专用 system prompt
  （强调"不写库、只返回 confirmation draft、不要描述为已执行"）
- **write_tools**: 执行 propose 工具
- **write_validate**: 检查是否产出了 `proposedActions`：
  - 有 → 正常路由到 respond
  - 无 → 设置 `stopReason: 'no_target'`，在 respond 中告知用户无法定位目标

#### `knowledge_subgraph`（知识检索）

```
knowledge_route → knowledge_agent ↔ knowledge_tools → knowledge_validate
```

- **knowledge_route**: 处理跨工具依赖——如果 relevant tools 同时包含
  `search_medicine_leaflets` 和 `get_cn_medicine_detail`，调整执行顺序
  确保 detail 先于 leaflet（复用 `tool.service.ts` 的
  `buildToolContext` productId 传递逻辑，但将其从 tool 执行时移到图节点）
- **knowledge_agent**: 只绑定知识检索工具，使用知识专用 system prompt
  （强调证据来源区分：CN leaflet vs DrugBank vs Medical QA）
- **knowledge_tools**: 执行知识检索工具
- **knowledge_validate**: 检查向量检索结果是否为空命中

#### `mixed`（跨类别 —— 简化版，见审查修订 R2）

不再构建 `mixed_subgraph`。`mixed` 意图直接路由到全量 `agent` 节点，
工具集为 `relevantTools` 并集，行为与现有图一致；仅标记
`intent: 'mixed'` 用于日志与后续观测。

### D4: State 扩展

在 `AssistantRuntimeState` 中新增字段：

```typescript
// ── Intent classification ──
intent: Annotation<AssistantIntent | null>({
  reducer: (_left, right) => right,
  default: () => null,
}),

relevantTools: Annotation<AssistantToolName[]>({
  reducer: (_left, right) => right,
  default: () => [],
}),

// ── Sub-graph tracking ──
activeSubGraph: Annotation<AssistantIntent | null>({
  reducer: (_left, right) => right,
  default: () => null,
}),

// ── Validation ──
validationFlags: Annotation<{
  hasEmptyResults: boolean;
  hasPartialCoverage: boolean;
  hasAmbiguities: boolean;
  missingProposedActions: boolean;
}>({
  reducer: (_left, right) => right,
  default: () => ({
    hasEmptyResults: false,
    hasPartialCoverage: false,
    hasAmbiguities: false,
    missingProposedActions: false,
  }),
}),

// ── Early exit ──
stopReason 扩展: 'answered' | 'no_match' | 'tool_cap_reached'
  | 'no_data'       // read 子图: 所有工具返回 empty coverage
  | 'no_target'     // write 子图: 未产出 proposedActions
  | 'no_evidence'   // knowledge 子图: 向量检索零命中
  | null,
```

### D5: 条件边路由函数

`classify_intent` 节点后的条件边：

```typescript
.addConditionalEdges('classify_intent', (state) => {
  switch (state.intent) {
    case 'simple_chat':    return 'respond';
    case 'read_data':      return 'read_subgraph';
    case 'write_proposal': return 'write_subgraph';
    case 'knowledge':      return 'knowledge_subgraph';
    case 'mixed':          return 'agent';   // ← 修订：走全量 agent 路径（见 R2）
    default:               return 'respond';
  }
})
```

子图内部的 agent → tools 条件边（复用现有 loop cap 逻辑 + 新增 validate）：

```typescript
// read_subgraph 内部
.addConditionalEdges('read_agent', (state) => {
  if (state.pendingToolCalls.length > 0 && state.loopCount < MAX_TOOL_LOOPS) {
    return 'read_tools';
  }
  return 'read_validate';
})
.addEdge('read_tools', 'read_agent')  // 循环回 agent（仅当还有 pendingToolCalls）
.addEdge('read_validate', 'respond')  // partial/empty 在 validate 内改写 ToolMessage
                                      // 后直通 respond，不额外回环（见审查修订 R3）
```

### D6: 子图作为编译后的图嵌入

LangGraph 支持将编译后的子图作为节点加入父图：

```typescript
const readSubGraph = buildReadSubGraph(deps);
const writeSubGraph = buildWriteSubGraph(deps);
const knowledgeSubGraph = buildKnowledgeSubGraph(deps);

const parentGraph = new StateGraph(AssistantRuntimeState)
  .addNode('classify_intent', classifyIntentNode)
  .addNode('read_subgraph', readSubGraph) // 编译后的子图作为节点
  .addNode('write_subgraph', writeSubGraph)
  .addNode('knowledge_subgraph', knowledgeSubGraph)
  .addNode('agent', agentNode) // 保留给 mixed 与兜底路径（见 R2）
  .addNode('respond', respondNode)
  .addEdge(START, 'classify_intent')
  .addConditionalEdges('classify_intent', intentRouter)
  .addEdge('read_subgraph', 'respond')
  .addEdge('write_subgraph', 'respond')
  .addEdge('knowledge_subgraph', 'respond')
  .addEdge('agent', 'respond')
  .addEdge('respond', END)
  .compile();
```

子图共享父图的 state schema（`AssistantRuntimeState`），不需要额外序列化/反序列化。

### D7: 差异化 System Prompt

当前 `buildAssistantSystemPrompt` 是一刀切的 37 行提示。升级后按子图拆分：

```typescript
function buildReadSystemPrompt(tools: readonly AssistantToolName[]): string;
// 强调: coverage, confidence, ambiguities, timeRange 字段
// 禁止: 幻觉数据, 忽略 partial coverage

function buildWriteSystemPrompt(tools: readonly AssistantToolName[]): string;
// 强调: proposal-only, 不写库, confirmation-required
// 禁止: 描述为已执行, 即兴猜测写入目标

function buildKnowledgeSystemPrompt(
  tools: readonly AssistantToolName[],
): string;
// 强调: 证据来源区分 (CN leaflet vs DrugBank vs Medical QA)
// 禁止: 交叉归因, 诊断/处方

function buildSimpleChatSystemPrompt(): string;
// 强调: 健康助手定位, 不诊断, 不改药
// 禁止: 声称查看了用户数据 (无工具)
```

### D8: `simple_chat` 直通路径

当 `classify_intent` 判定为 `simple_chat` 时，直接路由到 `respond`，跳过
agent 节点。`respond` 节点对此路径的处理：

- 如果 `finalContent` 仍为 null（无 LLM 调用产出），在 respond 中做一次
  轻量 LLM 调用（只传 simple chat prompt + user message，不绑工具）
- 这替代了当前 `core.service` 中的 `generateStream` 二次调用路径

---

## 审查修订（2026-08-01）

基于对现有代码的核实与 LangGraph 1.4.2 能力核对，对原计划作以下修订。

### R1: 重试改用图级 `setNodeDefaults`（替代手动 withLlmRetry）

原计划未安排重试；初稿建议的"agent 节点手动包 `withLlmRetry`"亦绕过了框架。
LangGraph 1.4.2 原生支持 `StateGraph.setNodeDefaults({ retryPolicy, cachePolicy, timeout, errorHandler })`：
在 `compile()` 时解析为全图节点默认值，未单独声明的节点自动继承（即"设定一次，
其他节点不说明就用默认"）。子图内部节点在父图 `compile()` 时同样受默认约束，
无需逐子图声明。

- 新增 **Phase 3.5**：一行声明全图默认，详情见下。
- **必须显式设置 `retryOn`**：`RetryPolicy` 缺省时对所有异常重试（含 400/401 等
  非瞬态错误），需复用 `common/llm/llm-retry.helper.ts` 的 `isRetryableLlmError`
  作为白名单，与 `generateStream` 现有 `withLlmRetry` 语义一致。
- 职责划分：circuit breaker 包住整图负责"上游整体故障"，`setNodeDefaults` 的
  retry 只负责单节点瞬态失败，两者不重叠。

### R2: 砍掉 mixed_subgraph，mixed 走全量 agent 路径

嵌套编译子图（mixed 内嵌 read/write/knowledge 子图）的 state 合并行为难以验证，
属过度设计。修订：Phase 6 的 `mixed` 意图**直接走现有全量 agent 路径**（行为不变），
仅标记 `intent: 'mixed'`，后续有真实数据支撑再拆子图。

### R3: read_validate 循环语义修正

"partial coverage → 回 read_agent 再 invoke 一次 LLM" 逻辑不完整（回环时
`pendingToolCalls` 为空，agent 不知道补充查什么）。修订：validate 节点**改写
ToolMessage**（追加 "coverage is partial, acknowledge this" 指令）后直通 respond，
让同一次最终调用处理；循环仅保留给"还有 pendingToolCalls"的场景。

### R4: 补充输出侧校验

原计划只覆盖工具结果校验（输入侧）。修订：respond 节点对 `finalContent` 做
非空/长度校验（simple_chat 轻量调用结果也可能为空，复用 `generateStream` 的
空内容抛错语义）。

### R5: 缓存落地方式（新增 Phase 8.5）

节点级缓存直接用 LangGraph 原生 `cachePolicy`（`keyFunc` + `ttl`，v1.4 新增）：

- `classify_intent` / `prepare_context` 等**确定性节点**开缓存；
- LLM/工具节点显式 `cachePolicy: false`，避免非确定性输出被缓存。
  工具结果缓存（向量检索）与 simple_chat 响应缓存仍需自定义实现，见 Phase 8.5。

---

## 实施阶段

### Phase 1: State 扩展 + Intent 分类节点

**目标**：在现有图中插入 `classify_intent` 节点，将 `selectRelevantToolsForMessage`
接入图运行时，但不改变后续路由（仍走原 agent 节点）。

**改动文件**：

1. `src/modules/assistant/agent/runtime/state.ts`
   - 新增 `intent`、`relevantTools`、`activeSubGraph`、`validationFlags` 字段
   - 扩展 `stopReason` union

2. `src/modules/assistant/agent/runtime/classify.ts`（新建）
   - 导出 `AssistantIntent` 类型
   - 导出 `classifyIntent(state)` 纯函数：调用
     `selectRelevantToolsForMessage` + 按前缀分类
   - 不调 LLM，纯规则

3. `src/modules/assistant/agent/runtime/classify.spec.ts`（新建）
   - 覆盖 5 种意图的分类逻辑
   - 边界：空消息、纯英文、混合意图

4. `src/modules/assistant/agent/runtime/graph.ts`
   - 在 `prepare_context` 和 `agent` 之间插入 `classify_intent`
   - `prepare_context` 仍负责 system prompt + initial messages
   - `classify_intent` 负责意图分类 + relevantTools 缩窄
   - **此阶段不改变路由**：`classify_intent` → `agent` 仍走原边
   - `agent` 节点改为使用 `state.relevantTools`（而非 `state.allowedTools`）
     绑定工具

5. `src/modules/assistant/agent/runtime/graph.spec.ts`
   - 新增：验证 `classify_intent` 被调用后 `relevantTools` 被缩小
   - 新增：`simple_chat` 路径标记 `stopReason: 'no_match'` 且不调 LLM
   - 保留：现有 3 个测试用例（行为不变，因为路由未改）

**验证**：`pnpm test -- graph.spec` + `pnpm test -- classify.spec` + `pnpm build`

---

### Phase 2: 差异化 System Prompt

**目标**：按意图使用不同的 system prompt，而非一刀切。

**改动文件**：

1. `src/modules/assistant/prompts/system.prompt.ts`
   - 保留 `buildAssistantSystemPrompt` 作为 fallback
   - 新增 `buildReadSystemPrompt`、`buildWriteSystemPrompt`、
     `buildKnowledgeSystemPrompt`、`buildSimpleChatSystemPrompt`
   - 从现有 prompt 中拆分共通部分（身份声明 + 安全边界）

2. `src/modules/assistant/prompts/system.prompt.spec.ts`（新建）
   - 验证各 prompt 包含/不包含关键指令

3. `src/modules/assistant/agent/runtime/graph.ts`
   - `classify_intent` 节点根据 `intent` 选择对应 prompt builder
   - 将选中的 prompt 写入 state（新增 `systemPrompt` 字段或复用 messages[0]）
   - `agent` 节点不再自己调 `buildAssistantSystemPrompt`，改用 state 中
     已准备好的 system prompt

**验证**：`pnpm test -- system.prompt.spec` + `pnpm test -- graph.spec` + `pnpm build`

---

### Phase 3: 条件边路由——simple_chat 直通

**目标**：`simple_chat` 意图直接路由到 `respond`，跳过 agent 节点，省一次 LLM 调用。

**改动文件**：

1. `src/modules/assistant/agent/runtime/graph.ts`
   - 将 `classify_intent → agent` 的直边改为条件边
   - `simple_chat` → `respond`
   - 其他意图 → `agent`（此阶段仍走原 agent，下一阶段才拆子图）

2. `src/modules/assistant/agent/runtime/respond.ts`（新建）
   - 导出 `respondNode` 函数
   - 如果 `finalContent` 为 null 且 `intent === 'simple_chat'`，
     做一次轻量 LLM 调用（无工具绑定）
   - 如果 `finalContent` 不为 null，直接返回（当前行为）
   - 对 `finalContent` 做非空/长度校验（输出侧校验，见审查修订 R4）
   - 将 `core.service` 中 `generateStream` 的非工具场景迁移到此处

3. `src/modules/assistant/agent/runtime/respond.spec.ts`（新建）
   - 验证 simple_chat 路径产出非空 content
   - 验证有 finalContent 时不做额外 LLM 调用

4. `src/modules/assistant/agent/runtime/graph.ts` 中的 `respond` 节点
   - 从 `() => ({})` 改为调用 `respondNode`

5. `src/modules/assistant/agent/runtime.service.ts`
   - `runConversation` 返回的 `finalContent` 在 simple_chat 路径下
     不再为 null（由 respond 节点产出）
   - `core.service.ts` 中的 `generateStream` 分支简化：当
     `finalContent != null` 时走 `streamPreGeneratedContent`，
     否则（仅在非 simple_chat 且 agent 未产出文本时）走 `generateStream`

**验证**：`pnpm test -- respond.spec` + `pnpm test -- graph.spec` + `pnpm build`

---

### Phase 3.5: 图级 setNodeDefaults —— 重试/超时/错误兜底默认值

**目标**：用 LangGraph 原生机制一次性声明全图默认策略（见审查修订 R1），
替代节点内手动包裹重试。

**改动文件**：

1. `src/modules/assistant/agent/runtime/graph.ts`
   - `buildAssistantRuntimeGraph` 中在 `compile()` 前调用 `setNodeDefaults`：

   ```typescript
   .setNodeDefaults({
     retryPolicy: {
       retryOn: isRetryableLlmError,   // 白名单：仅瞬态错误重试
       maxAttempts: 3,
     },
     timeout: AI_MODEL_TIMEOUT_MS,     // 复用现有超时常量
     cachePolicy: false,               // 默认不开缓存；LLM/工具节点非确定性
   })
   ```

   - `isRetryableLlmError` / `AI_MODEL_TIMEOUT_MS` 直接导入 common，不新增 deps
   - 确定性节点单独开启缓存（见 Phase 8.5）；个别节点可节点级覆盖
     `addNode(..., { retryPolicy: false })` 退出图默认

2. `src/modules/assistant/agent/runtime/graph.spec.ts`
   - 新增：瞬态错误（5xx/timeout/429）触发重试
   - 新增：非瞬态错误（400/401）不消耗重试预算
   - 新增：`recursionLimit` 兜底验证（默认 25）

**验证**：`pnpm test -- graph.spec` + `pnpm build`

---

### Phase 4: Read 子图 + 验证节点

**目标**：将 read 类工具的 agent↔tools 循环封装为子图，新增工具结果校验。

**改动文件**：

1. `src/modules/assistant/agent/runtime/subgraphs/read.ts`（新建）
   - 导出 `buildReadSubGraph(deps)` 函数
   - 3 节点：`read_agent` ↔ `read_tools` → `read_validate`
   - `read_agent`：绑定 `relevantTools` 中的 `get_*` 工具，使用
     `buildReadSystemPrompt`
   - `read_tools`：调用 `deps.executeTools`，追加 ToolMessage
   - `read_validate`：检查 `coverage.status`，设置 `validationFlags`；
     partial/empty 时**改写 ToolMessage**（追加指令），不额外回环
     （见审查修订 R3）
   - 条件边：`read_validate` → `respond` 直通，循环仅由
     `pendingToolCalls` 驱动

2. `src/modules/assistant/agent/runtime/subgraphs/read.spec.ts`（新建）
   - 验证完整 coverage → 直通 respond
   - 验证 partial coverage → 改写 ToolMessage 后直通 respond（不额外回环）
   - 验证 empty coverage → `stopReason: 'no_data'`

3. `src/modules/assistant/agent/runtime/validate.ts`（新建）
   - 导出 `validateReadResults(toolResults)` 纯函数
   - 检查 envelope 中的 `coverage.status`、`confidence.level`、`ambiguities`
   - 返回 `validationFlags` 对象

4. `src/modules/assistant/agent/runtime/validate.spec.ts`（新建）

5. `src/modules/assistant/agent/runtime/graph.ts`
   - `classify_intent` 条件边：`read_data` → `read_subgraph`（编译后的子图节点）
   - `read_subgraph` → `respond`

**验证**：`pnpm test -- read.spec` + `pnpm test -- validate.spec` + `pnpm test -- graph.spec` + `pnpm build`

---

### Phase 5: Write 子图 + Knowledge 子图

**目标**：拆分写入提案和知识检索为独立子图。

**改动文件**：

1. `src/modules/assistant/agent/runtime/subgraphs/write.ts`（新建）
   - 3 节点：`write_agent` ↔ `write_tools` → `write_validate`
   - `write_agent`：绑定 `propose_*` 工具，使用 `buildWriteSystemPrompt`
   - `write_tools`：执行 propose 工具
   - `write_validate`：检查 `proposedActions` 是否产出
   - 无 proposedActions → `stopReason: 'no_target'`

2. `src/modules/assistant/agent/runtime/subgraphs/write.spec.ts`（新建）

3. `src/modules/assistant/agent/runtime/subgraphs/knowledge.ts`（新建）
   - 4 节点：`knowledge_route` → `knowledge_agent` ↔ `knowledge_tools` → `knowledge_validate`
   - `knowledge_route`：处理跨工具依赖（productId 传递）
   - `knowledge_agent`：绑定知识检索工具，使用 `buildKnowledgeSystemPrompt`
   - `knowledge_tools`：执行知识检索工具
   - `knowledge_validate`：检查向量检索命中数

4. `src/modules/assistant/agent/runtime/subgraphs/knowledge.spec.ts`（新建）

5. `src/modules/assistant/agent/runtime/graph.ts`
   - `classify_intent` 条件边完整路由到 4 个子图
   - 各子图 → `respond`

**验证**：`pnpm test -- write.spec` + `pnpm test -- knowledge.spec` + `pnpm test -- graph.spec` + `pnpm build`

---

### Phase 6: Mixed 意图路由（简化版）

**目标**：处理跨类别意图（如"查最近记录并帮我记一条饮水"）。
按审查修订 R2，**不构建 mixed_subgraph**，`mixed` 走现有全量 agent 路径。

**改动文件**：

1. `src/modules/assistant/agent/runtime/graph.ts`
   - `classify_intent` 条件边：`mixed` → `agent`（与 read/write/knowledge
     尚未拆子图前的行为一致，绑定的工具集为 `relevantTools` 全量）
   - `intent === 'mixed'` 仅用于标记/日志，不改路由

2. `src/modules/assistant/agent/runtime/classify.ts`
   - `mixed` 分类输出 `relevantTools` 为跨类别工具集的并集

3. `src/modules/assistant/agent/runtime/classify.spec.ts`
   - 新增：混合意图（"查最近记录并记一条饮水"）分类为 `mixed`，
     且 `relevantTools` 同时包含 read 与 propose 工具

**验证**：`pnpm test -- classify.spec` + `pnpm test -- graph.spec` + `pnpm build`

> 备注：若后续观测到 mixed 场景占比高，再评估是否拆子图；当前不引入
> 嵌套编译子图的 state 合并复杂度。

---

### Phase 7: 迁移 core.service 逻辑到图内

**目标**：将 `core.service.ts` 中的 memory 注入和 tool context 注入逻辑
迁移到图节点中，使图成为完整的编排单元。

**改动文件**：

1. `src/modules/assistant/agent/runtime/graph.ts`
   - `prepare_context` 节点新增 memory 注入逻辑（从
     `AssistantConversationService.buildMemoryBlock` 获取，当
     `memoryEnabled && isNewConversation` 时）
   - `prepare_context` 节点新增 tool context block 构建（从
     `AssistantContextService.buildToolContextBlock` 获取）
   - Graph deps 新增 `buildMemoryBlock` 和 `buildToolContextBlock` 回调

2. `src/modules/assistant/agent/runtime/graph.ts` 的 deps 接口

   ```typescript
   export interface AssistantGraphDeps {
     createModel: ModelFactoryFn;
     executeTools: ToolExecutorFn;
     buildSystemPrompt: SystemPromptFn;
     // 新增
     buildMemoryBlock?: (userId: string) => Promise<string>;
     buildToolContextBlock?: (
       results: readonly AssistantToolExecutionResult[],
     ) => string;
   }
   ```

3. `src/modules/assistant/agent/runtime.service.ts`
   - `runConversation` 传入新的 deps
   - 返回值新增 `validationFlags` 供 core.service 判断

4. `src/modules/assistant/services/core.service.ts`
   - `streamMessages` 简化：memory 注入和 tool context 注入不再在
     `buildGenerationMessages` 中做，而是由图内部处理
   - `buildGenerationMessages` 简化为仅传 messages

**验证**：`pnpm test -- graph.spec` + `pnpm test -- runtime.service.spec` + `pnpm build`

---

### Phase 8: 文档与清理

**改动文件**：

1. `docs/02-logs/migration-log/YYYY-MM-DD.md` — 追加迁移日志
2. `src/modules/assistant/agent/runtime/state.ts` — 更新 `ASSISTANT_RUNTIME_NODE_NAMES`
3. `src/modules/assistant/tools/shared/tool-constants.ts` — 如有新的常量
   （如子图 loop cap、validation 相关常量）则新增
4. 删除 `core.service.ts` 中已迁移到图内的逻辑的旧代码路径

**验证**：`pnpm lint:check` + `pnpm typecheck` + `pnpm build` + `pnpm test:ci`

---

### Phase 8.5: 三层缓存

**目标**：降低 LLM / 向量检索成本，缓解子图化后 LLM 调用次数增加的影响
（见审查修订 R5）。

**改动文件**：

1. 节点级缓存（LangGraph 原生 `cachePolicy`，v1.4 新增）
   - `classify_intent`：`addNode('classify_intent', fn, { cachePolicy: { ttl: 3600 } })`
     —— 纯规则、确定性高，按 `userMessage` + `allowedTools` 自动 keyed
   - `prepare_context`：同上；LLM 节点保持 `cachePolicy: false`
   - 若需跨请求共享，`compile({ cache: createCache(...) })` 换 Redis 后端
2. 工具级缓存：向量检索工具（`search_cn_medicine_products`、
   `search_medicine_leaflets`、`search_medical_qa_corpus`、drugbank 系列）
   - 按 `(query, locale)` + TTL 缓存结果，复用 cache-manager / Redis
   - 医药数据低频更新，TTL 失效策略足够；不做主动失效
3. 响应级缓存：仅 `simple_chat` 路径的完整回复
   - key = `locale + messageHash + promptVersion`
   - **禁止**缓存带用户数据 / 工具结果的路径（个性化上下文污染）

**验证**：缓存命中率接入 `metricsService`；`pnpm test:ci` + `pnpm lint:check` 通过

---

## 目标图结构（完整）

```
START → prepare_context → classify_intent
                           │
                           ├─ simple_chat ──────────────────────→ respond → END
                           │
                           ├─ read_data ──→ [read_subgraph] ──→ respond → END
                           │                   │
                           │                   ├─ read_agent ←─→ read_tools
                           │                   │      ↓
                           │                   └─ read_validate
                           │                        ↑ (partial coverage → loop)
                           │
                           ├─ write_proposal → [write_subgraph] → respond → END
                           │                      │
                           │                      ├─ write_agent ←─→ write_tools
                           │                      │      ↓
                           │                      └─ write_validate
                           │
                           ├─ knowledge ──→ [knowledge_subgraph] → respond → END
                           │                   │
                           │                   ├─ knowledge_route
                           │                   │      ↓
                           │                   ├─ knowledge_agent ←─→ knowledge_tools
                           │                   │      ↓
                           │                   └─ knowledge_validate
                           │
                           └─ mixed ──→ agent（全量 relevantTools）→ respond → END
                                          （简化版：不拆子图，见审查修订 R2）
```

---

## 依赖关系

```
Phase 1 (state + classify)
  └─→ Phase 2 (diff prompts)
        └─→ Phase 3 (simple_chat shortcut)
              └─→ Phase 3.5 (图级 setNodeDefaults: 重试/超时默认)
                    └─→ Phase 4 (read subgraph + validate)
                          └─→ Phase 5 (write + knowledge subgraphs)
                                └─→ Phase 6 (mixed 简化: 走全量 agent 路径)
                                      └─→ Phase 7 (migrate core.service)
                                            └─→ Phase 8 (docs + cleanup)
                                                  └─→ Phase 8.5 (三层缓存)
```

Phase 1-3 是渐进式改造现有图，不破坏行为。Phase 4-6 是增量添加子图。
Phase 3.5 可在 Phase 3 后任意时机插入（独立于子图拆分）。Phase 7 是收敛迁移。
Phase 8.5 依赖 Phase 1 的 classify_intent 节点，放在最后以先验证稳定性再优化成本。
每个阶段独立可测试可部署。

---

## 回滚策略

| 阶段      | 回滚方式                                                                        |
| --------- | ------------------------------------------------------------------------------- |
| Phase 1   | 删除 `classify_intent` 节点，恢复 `prepare_context → agent` 直边                |
| Phase 2   | `classify_intent` 不再选 prompt，恢复 `agent` 自调 `buildAssistantSystemPrompt` |
| Phase 3   | `simple_chat` 不再直通，恢复走 `agent` 节点                                     |
| Phase 3.5 | 移除 `setNodeDefaults` 调用，恢复无图级默认（重试回到仅流式路径）               |
| Phase 4   | `read_data` 不走路由到子图，恢复走 `agent`（与 Phase 3 前一致）                 |
| Phase 5   | `write/knowledge` 不走子图，恢复走 `agent`                                      |
| Phase 6   | 无回滚成本——`mixed` 本就走全量 `agent` 路径（简化版）                           |
| Phase 7   | `core.service` 恢复 `buildGenerationMessages` 中的 memory/tool context 注入     |
| Phase 8.5 | 移除 `cachePolicy` / 缓存 key，恢复每节点直算                                   |

每个 Phase 的改动都在 `graph.ts` 的构建函数中集中，回滚即恢复图的构建逻辑。
子图文件可保留不删除（不会被引用），避免文件级回滚冲突。

---

## 风险评估

| 风险                                             | 可能性 | 影响 | 缓解                                                                                |
| ------------------------------------------------ | ------ | ---- | ----------------------------------------------------------------------------------- |
| 关键词路由误分类意图                             | 中     | 中   | `mixed` 意图兜底走原 agent 全量路径；分类逻辑有充分测试                             |
| 子图 state 隔离不充分                            | 中     | 高   | 共享 `AssistantRuntimeState` schema，子图不引入新 state 字段                        |
| 工具结果校验过于严格导致死循环                   | 低     | 中   | validate 节点受 `MAX_TOOL_LOOPS` 约束，不会无限循环                                 |
| 跨工具依赖（productId 传递）在子图中断裂         | 中     | 中   | knowledge_route 节点复用 `tool.service.ts` 的 `buildToolContext` 逻辑               |
| simple_chat 直通路径产出空内容                   | 低     | 低   | respond 节点有 fallback LLM 调用                                                    |
| Phase 7 迁移后 core.service 与图之间出现循环依赖 | 低     | 中   | 图 deps 使用回调函数注入，不直接注入 service                                        |
| 子图编译后作为节点时的 state 合并行为不符合预期  | 中     | 高   | Phase 4 先在隔离测试中验证子图 state 合并，再接入父图                               |
| `setNodeDefaults.retryOn` 未设置导致重试一切异常 | 高     | 中   | 显式传入 `isRetryableLlmError`；graph.spec 覆盖 400/401 不重试                      |
| 节点缓存命中过期/不一致数据                      | 中     | 中   | 仅确定性节点开缓存；`cachePolicy.ttl` 限制；promptVersion 参与 key                  |
| simple_chat 响应缓存污染个性化                   | 低     | 高   | 仅无工具路径缓存；key 含 locale + messageHash + promptVersion；带用户数据路径不缓存 |

---

## 完成标准

1. `selectRelevantToolsForMessage` 在图运行时被调用，LLM 收到的工具集按意图缩小
2. `simple_chat` 意图跳过 agent 节点，仅一次 LLM 调用（respond 内）
3. read/write/knowledge 三类意图各有独立子图和差异化 system prompt
4. 工具结果校验节点存在并改写 ToolMessage 影响最终回复（partial coverage 不额外回环）
5. 图级 `setNodeDefaults` 重试生效：瞬态错误重试、400/401 等非瞬态错误不重试
6. `mixed` 意图走全量 agent 路径（不引入嵌套子图）
7. 确定性节点（`classify_intent` / `prepare_context`）缓存命中率进入 metrics；
   simple_chat 响应缓存仅限无工具路径
8. `core.service.ts` 的 `buildGenerationMessages` 不再在图外注入 memory/tool context
9. 所有测试通过：`pnpm test:ci` + `pnpm lint:check` + `pnpm typecheck` + `pnpm build`
10. 现有 graph.spec.ts 的 3 个行为测试用例在 Phase 1-3 后仍通过（向后兼容）
