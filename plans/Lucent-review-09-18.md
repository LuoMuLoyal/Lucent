# Lucent 每日代码审查 · 2026-09-18

- 审阅日期：2026-09-18（上海时区）
- 提交区间：UTC 2026-09-17 16:00:00 ~ UTC 2026-09-18 15:59:59（= 上海 2026-09-18 00:00:00 +0800 ~ 23:59:59 +0800）
- 最早 commit: `79a0be56` `feat(schema): 对齐中成药表结构与V3数据模型`
- 最晚 commit: `57c6487d` `docs(logs): 登记 LightRAG 替代旧散文检索及审查报告引用修正`
- commit 数: 40

## 概要

本日核心动作是把中文散文检索（说明书字段级 + 医学问答）从 Lucent 自管的向量链路切换到 LightRAG sidecar，并把 `search_cn_medicine_products` 之外的两个旧向量检索工具（`search_medicine_leaflets` / `search_medical_qa_corpus`）下线收敛为 `search_cn_medicine_knowledge`。围绕这次切换完成了 8 条主链改动 + 7 条配套修复：

- **接入层**：`config/env/env-keys.enum.ts` + `environment.validation.ts` 增加 6 项 `LIGHTRAG_*`；`compose.dev.yaml / compose.staging.yaml / compose.yaml` 编排 sidecar；`Dockerfile` 拆分 build / production 层并瘦身运行时镜像（删 swagger-ui-dist、query_compiler 其它方言副本、未用字体等）。
- **客户端**：`tools/retrieval/lightrag-client.service.ts`（+ 配套 `lightrag.types.ts` / `knowledge.service.ts`）约 800 行新代码，封装 `only_need_context=true` 的 `POST /query`、`/health`、`X-API-Key` 鉴权、doc-id 反解（`leaflet:` / `qa:` 两种形态），失败一律判别式 `LightragCallFailure`。
- **能力可见性**：`assistant/services/policy.service.ts` + `agent/runtime.service.ts` 引入 `retrievalAvailable` 与新的 disabled reason `retrieval_unavailable`，让客户端在 sidecar 关闭 / 鉴权缺失时显示"检索暂不可用"而非"未找到证据"。
- **provider 错误归一**：`assistant/services/provider-failure.ts`（97 行新增）把 LLM 上游 4xx/5xx 统一映射成 `DEPENDENCY_*` `DomainFailure`，`stream-orchestrator.service.ts` 与 `runtime.service.ts` 都接入。
- **校验错误透出**：`common/filters/validation-exception.ts`（39 行新增）让 Standard Schema `path` 进 problem+json body 的 `errors.issues[]`，附 `api-exception.target.spec.ts` 用例覆盖 `.strict()` 多键拒绝的场景。
- **缓存容错**：`medicines/cache/store.service.ts` 的 `cacheGet` / `cacheSet` 改"失败降级 + warn"而非向上抛，避免 Redis 抖动把读路径打成 500。
- **小修**：Medicine dose-logs 错误码拆出 `DOSE_LOG_TARGET_UNRESOLVED`；today-suggestion 拒绝模型把内部标识符当 `actionLabel` 回填；dashboard 稀疏期不再输出变化量且 `+0.0` 修成 `0.0`；i18n 键 (`medicine.candidatePreflightError.detail`) 替代硬编码中文。

整体质量很高：所有新文件都走 `ConfigService`（无 `process.env` 直读），错误一律走 `DomainFailureException`/判别式结果，文档/迁移日志/计划文件三处对齐。下面列出本次仍值得注意的几条。

---

## critical

无。

---

## warning

### W1 · `assistant/services/provider-failure.ts` 与 `assistant/tools/retrieval/lightrag-client.service.ts` 各自维护一份 HTTP 状态码分类常量与边界判断

**位置**

- `src/modules/assistant/services/provider-failure.ts:40-77`
- `src/modules/assistant/tools/retrieval/lightrag-client.service.ts:44-46, 280-310`

**事实**
两个层都做了"按 HTTP status 分类"。LightRAG 客户端已经把 401/403/400/422/5xx 提到 `HTTP_STATUS_*` 具名常量；`provider-failure.ts` 仍是裸字面量（`if (status === 429)` / `if (status === 408 || status === 504)` 等），并直接对比字面整数。

**影响**
短期不影响功能；中期在"再加一种上游错误类别"或"统一状态码语义"时会双重改动，且容易漏改一边。

**建议**

- 把状态码常量提到 `src/common/http/http-status.constants.ts`（或 `assistant/constants/http-status.constants.ts`），让 `provider-failure.ts` 与未来的其他上游客户端共用。
- 若不抽常量，至少按 LightRAG 客户端的写法把字面量提到模块顶部具名常量，与 `lightrag-client` 风格保持一致。

---

### W2 · `stream-orchestrator.toDomainFailure` / `runtime.toDomainFailure` / `proposal-confirm.toDomainFailure` 三处复制粘贴

**位置**

- `src/modules/assistant/services/stream-orchestrator.service.ts:404-419`
- `src/modules/assistant/agent/runtime.service.ts:540-561`
- `src/modules/assistant/services/proposal-confirm.service.ts:229-...`

**事实**
三段几乎一字不差：先判 `DomainFailureException`，再 `classifyProviderFailure(error)`，没有命中则 `throw error`。

**影响**
逻辑集中在三处，每次 `classifyProviderFailure` 扩展（比如把超时/网络层也覆盖）需要同步改三处；当 `provider-failure.ts` 在 `adab7b55` 加 401/403 retryable 分支时虽然只动了一处，但调用点的复制没有减少。

**建议**
抽到 `assistant/services/domain-failure.ts`（或 `common/result/to-domain-failure.ts`），签名 `toDomainFailure(error: unknown): DomainFailure`，三处直接调用：

```ts
export function toDomainFailure(error: unknown): DomainFailure {
  if (error instanceof DomainFailureException) return error.failure;
  const provider = classifyProviderFailure(error);
  if (provider != null)
    return createDomainFailure({
      kind: 'dependency',
      code: provider.code,
      detail: provider.detail,
      retryable: provider.retryable,
    });
  throw error;
}
```

---

### W3 · `assistant/tools/retrieval/lightrag-client.service.ts` 的 `FALLBACK_BASE_URL` / `FALLBACK_TIMEOUT_MS` 与 `environment.validation.ts` 的 zod 默认值重复维护

**位置**

- `src/modules/assistant/tools/retrieval/lightrag-client.service.ts:23-24`
- `src/config/env/environment.validation.ts:309-318`

**事实**
默认值 `'http://lightrag:9621'` 与 `8000` 在两处独立写死，注释里承认"与 zod 校验层默认值一致的兜底值"。ConfigService 走的是 `validateEnvironment` 写回 `process.env` → ConfigService `get()` 的链路，所以兜底分支在生产环境永远不会被命中（这只是给直接 `new ConfigService()` 的测试 / 异常路径用）。

**影响**

- 改默认端口需要同步两处。
- 测试如果不走 `validateEnvironment`，兜底值就是客户端实际使用的值，与生产行为漂移。

**建议**
将默认值集中到 `config/env/environment.defaults.ts` 或在 `env-keys.enum.ts` 旁边新建 `LIGHTRAG_DEFAULT_BASE_URL` / `LIGHTRAG_DEFAULT_TIMEOUT_MS` 常量，由 `environment.validation.ts` 与 `lightrag-client.service.ts` 各自 import；至少改成单点导出（默认值在 zod schema 里，client 端在 zod 解析失败时再走兜底）。

---

### W4 · `assistant/services/policy.service.ts` 把 `ASSISTANT_RETRIEVAL_TOOL_NAMES` 包装成 `Set`，但调用点都是单次 `.has()`，Set 化是过度设计

**位置**

- `src/modules/assistant/services/policy.service.ts:21-24`

**事实**

```ts
const RETRIEVAL_TOOL_NAMES: ReadonlySet<AssistantToolName> = new Set(
  ASSISTANT_RETRIEVAL_TOOL_NAMES,
);
```

单元素数组（`['search_cn_medicine_knowledge']`）包 Set 没必要，且和别处的 `includes` 风格（`contextPermittedToolNames.includes(toolName)`）不一致。

**影响**
极小，纯风格层面；但当前 `ASSISTANT_RETRIEVAL_TOOL_NAMES` 注释明确说明"故意只放 cn_medicine_knowledge；DrugBank 不在内"，未来若扩到 ≥ 3 个检索工具时，Set 化的"查得快"价值才出现。

**建议**

- 要么改回 `readonly AssistantToolName[]` + `.includes`（与同文件其它分支一致）；
- 要么在 `tool-types.ts` 处直接导出 Set，避免在调用点二次包装。

---

## suggestion

### S1 · `assistant/tools/retrieval/knowledge.service.ts` 的 `parseMode` 拒绝 `bypass` 用的是字符串字面量而非白名单

**位置**

- `src/modules/assistant/tools/retrieval/knowledge.service.ts:230-237`

**事实**

```ts
if (raw === 'bypass') {
  return { ok: false, reason: ... '"bypass" mode is not allowed.' };
}
```

该判断绕过了 `LIGHTRAG_QUERY_MODES` 白名单（注释解释"点名拒绝"），但 `LIGHTRAG_QUERY_MODES` 的 TS 类型 `(typeof LIGHTRAG_QUERY_MODES)[number]` 已经把 `bypass` 排除，TS 编译时会要求 `raw === 'bypass'` 必须被显式断言。

**建议**

- 把 `bypass` 提到 `lightrag.types.ts` 的 `LIGHTRAG_REJECTED_MODES = ['bypass']` 列表，并在 `parseMode` 里 `if (LIGHTRAG_REJECTED_MODES.includes(raw))`——这样未来若新增一个危险 mode，只需改 types 处，不必每次在工具层加字面量。
- 或者把"已知危险 mode"列表 + "已知合法 mode"列表合并成一个 `LIGHTRAG_QUERY_MODES` 联合类型 + 常量数组，配合 `as const satisfies` 在编译期保证互斥。

---

### S2 · `today-suggestion/schemas/copy.schema.ts` 的 `INTERNAL_IDENTIFIER` 正则只覆盖 snake_case / camelCase，不覆盖纯小写单词

**位置**

- `src/modules/today-suggestion/schemas/copy.schema.ts:18-19`

**事实**

```ts
const INTERNAL_IDENTIFIER =
  /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$|^[a-z]+(?:[A-Z][a-z0-9]*)+$/;
```

正则必须"至少一个 `_`/`-`/大写字母切换"才能匹配，所以 `"logdose"`、`"complete"`、`"save"` 等单段小写词不会被识别为内部标识符。本次补丁目标里的 `complete_profile` / `mark_as_taken` / `logDose` 都被覆盖，但如果新 prompt 把 `templateKey` 命名空间改成单词形态，正则就会失效。

**影响**
模型回填 actionLabel 的 leak 风险并未完全关闭：未来 `templateKey` 命名风格换了，这个安全网会失灵。

**建议**

- 维护一份明确的"已知内部标识符"白名单（`KNOWN_INTERNAL_ACTION_LABELS = new Set(['complete_profile', 'mark_as_taken', ...])`），Zod refine 用白名单 `refine((v) => !KNOWN.has(v))`。模型能输出的显示文本近无穷，模型能"忘本"复制粘贴的内部标识符是有限集，白名单是更稳的来源。
- 如果想保留正则风格，至少把单段小写也覆盖：`/^[a-z][a-z0-9_]*$/` 加上"长度 ≥ 4 且全是小写无空格"，并在测试里覆盖 `"logdose"` 这类 case。

---

### S3 · `medicine-dose-logs/services/dose-logs.service.ts:488` 的 `TODO(error)` 是预存债，本次未偿还但仍在

**位置**

- `src/modules/medicine-dose-logs/services/dose-logs.service.ts:485-489`

**事实**

```ts
// HealthEventsOwnershipService keeps the legacy Promise<T> contract and
// folds the events module ResultAsync with unwrapResult (its DomainFailure
// surfaces as DomainFailureException through the global filter). Unknown
// failures rethrow. TODO(error): consume the events Result directly when
// the health-events ownership shim is removed (Task 10).
```

注释里写 `Task 10` 但 `docs/TODO.md` 里没有对应条目（本日 `2b6ab688` 只登了 D1 safety-tips 死代码台账）。

**建议**

- 把 `Task 10` 加进 `docs/TODO.md`（同 D1 / B7 风格），便于下次审查追踪；否则 Task 编号漂在代码注释里，台账失效。

---

### S4 · `setup-app.ts` 在本次改动中动 22 行，未在 commit message 中单独说明

**位置**

- `src/setup-app.ts`（±22 行，`git diff --stat` 显示）

**事实**
`git log --stat` 把 `setup-app.ts` 列在 LightRAG 相关 commit 里，但 commit message 只描述了对应工具的注册动作，未明确 `setup-app.ts` 的变化内容（很可能是新增全局 `ValidationException` 注册或 LightRAG 客户端的 module wiring）。

**建议**

- 后续若 `setup-app.ts` 是"接插件"性质的小改，可在 commit body 里加一行 "wires LightRAG-enabled flag at bootstrap" 或 "registers ValidationException as the global BadRequestException factory"，便于 grep 检索。

---

### S5 · `assistant/agent/runtime/tool-keyword-rules.ts` 的 `search_cn_medicine_knowledge` 正则仍包含旧向量时代的若干词

**位置**

- `src/modules/assistant/agent/runtime/tool-keyword-rules.ts:182-227`

**事实**
`/说明书/` `/leaflet/i` `/ingredient/i` 仍然存在并合理；但 `/indication/i`、`/适应症/`、`/成分/`、`/相互作用/`、`/药理学/` 等词同时出现在 `search_cn_medicine_knowledge` 与（已下线的）`search_medical_qa_corpus` 的旧 keyword 规则里。本日 `45c4feb8` / `28769276` 把工具下线时**没有**把旧规则的关键词移除，只是删了工具本身。

**影响**
极小：被下线的工具对应的路由分支（router.ts）已经移除，这些孤立正则永远不会被触发。

**建议**

- `tool-keyword-rules.ts` 与 `tool-types.ts` 强耦合（必须每个 `AssistantToolName` 都有一份规则），可以考虑把"未实现的工具"显式标成 `[]` 并加注释，避免未来回滚时绕开 keyword 检查；本次 diff 里 `search_drugbank_passages` 已经标 `[]`，是同方向的好实践。

---

## 信息项（不计入问题）

- **`env-keys.enum.ts`** 新增 6 个 `LIGHTRAG_*` 键，统一进 zod schema + `assertLightragEnvironment` 交叉校验，启动期能拦住"启用但 key 缺失"。设计正确。
- **`compose.dev.yaml / compose.staging.yaml / compose.yaml`** 新增 `lightrag` sidecar（dev profile / staging / prod），环境变量清单独立在 `deploy/lightrag/.env.example`，与 Lucent 自己的 env 文件解耦。设计正确。
- **`Dockerfile`** 移除 chown 重复层、剪 source map / 包内 md / Prisma 其它方言 query_compiler / 未用 swagger-ui-dist。每一步都在迁移日志里说明验证手段（`prisma migrate deploy + /api/v1/health + /api/docs + /scalar/standalone.js + /admin`）。值得肯定。
- **`medicines/cache/store.service.ts` W2 修复**：把"读/写缓存失败"由抛错改为降级 + warn，配合日志可观测，符合"缓存不是 source of truth"的共识。本次 review 接受降级语义，但**建议**在 `getOrSet` 处加一条 metrics（MISS_HIT_RATIO 已存在的可以扩展），便于后续观测降级命中率。
- **`medicines/adapters/cn.service.ts` S2 + `medicines/utils/data-format.ts` 29e717ae**（`toTypedJsonArray` 收敛）：重复模式收敛为泛型 helper，回归测试覆盖三种 DrugBank 列；helper 内部 `if (mapped !== null) typed.push(mapped)` 是常见的守卫式 map，结构清晰。
- **`medicines/medicines.controller.ts:82` 与 `medicines.service.ts:210`** 的 `safety-tips` 死代码端点已通过 `2b6ab688` 在 `docs/TODO.md` D1 登记，注释统一指向 TODO。符合"dead code 必须留引用 + 台账"规约。
- **`assistant/prompts/system.prompt.ts`** 新增两段 LightRAG 提示（中文散文检索规则 + 问答可信度提示），都明确"不要诊断/不要改剂量/不要替代医生"；并保持 qa 来源"开放语料、低可信教育参考"的标记（`open_corpus`）不变，避免前端静默失去低可信提示。值得肯定。
- **`assistant/agent/runtime.service.ts:336-339`**：`describeFoundation` 由 async 改 sync，原因是 `retrievalAvailable` 直接读 `LightragClientService.isEnabled()`，不再需要等 DB 读旧 `hasIndexedChunks()`。语义正确。
- **`common/filters/validation-exception.ts`** + `api-exception.target.spec.ts` 用例：让 `.strict()` 多键拒绝的 `path` 进 problem+json body 的 `errors.issues[]`，正是 commit message 里说的"客户端能看出哪个键被拒"的修复。

---

## 建议本轮未处理项的处置

- W1/W2/W3 建议合一个 PR 处理（都是"少一处复制、共享语义"），分别约 30 / 60 / 15 行改动。
- W4 / S1 / S4 是纯风格与一致性。
- S2 关系到安全性（标识符 leak），建议单独 PR 且附"如何扩充 templateKey 白名单"的协作说明。
- S3 是文档台账维护，补一行即可。
- S5 是 dead-code 清理的小整理，可与 W1/W2 一并提交。
