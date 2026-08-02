# rnacos 动态运行时配置与调优实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不重启 Lucent 进程的情况下，动态调整餐食识别、队列和缓存的可调参数，并保留环境变量作为启动期兜底配置。

**Architecture:** 引入一个与 rnacos 解耦的 `RuntimeConfigService`，维护经过 Zod 校验的不可变配置快照和版本号。环境变量提供初始值；rnacos 作为可选的远程配置源，通过长轮询或已验证的 Nacos 协议客户端推送变更；变更只有在完整校验通过后才以原子方式替换快照，失败时继续使用上一份有效配置。业务服务只依赖运行时配置抽象，不直接依赖 rnacos。

**Tech Stack:** NestJS 11, TypeScript 6, Zod 4, Node.js 24 原生 `fetch`, rnacos/Nacos HTTP 配置协议, BullMQ 5, `@nestjs/cache-manager`, Vitest, Docker Compose。

---

## 当前状态与问题边界

当前实现已经有一套启动期配置校验，但可调参数被不同方式固定：

- `src/llm-runtime/services/llm-runtime.service.ts` 构造时注入 `llmConfig` 快照；模型实例在调用时创建，但来源配置不是动态的。
- `src/modules/daily-records/services/meal-analysis/vision.service.ts` 将视觉模型的 `temperature=0.1`、`maxRetries=0` 和提示词写在代码中。
- `src/modules/daily-records/services/meal-analysis/matcher.service.ts` 在构造函数中读取餐食份量和营养阈值，后续请求不会重新读取。
- `src/common/queue/queue.factory.ts` 在构造时读取 `REDIS_URL`，创建 worker 时固定 `concurrency`、重试和保留策略。
- `src/config/services/cache.config.ts` 在启动时创建 Redis/内存 store；连接地址和 store 类型不能热切换。
- 多个业务缓存服务在各自常量中固定 TTL；缓存 TTL 的热更新只能影响之后写入的缓存，不会修改已经存在的 key 的过期时间。

本计划不把所有环境变量都变成热配置。尤其是数据库连接、Redis 地址、rnacos 地址和认证凭据、JWT/API 密钥、端口、CORS、模块拓扑、OpenTelemetry 启动开关仍属于启动配置，修改后需要重启。

## 第一版配置契约

远程配置使用一个按环境隔离的 JSON 文档，建议固定为：

- `dataId`: `lucent-runtime-tuning.json`
- `group`: `LUCENT_RUNTIME`
- `namespace`: 由部署环境决定，例如 `development`、`test`、`production`

配置只包含非敏感调优项。初版结构如下，字段名是 Lucent 内部契约，不直接复用环境变量名：

```json
{
  "schemaVersion": 1,
  "revision": "meal-v1",
  "meal": {
    "vision": {
      "model": null,
      "temperature": 0.1,
      "maxRetries": 0,
      "systemPrompt": null,
      "userPrompt": null
    },
    "matching": {
      "defaultPortionGrams": 100,
      "smallPortionGrams": 30,
      "highProteinThresholdG": 20,
      "lowCarbohydrateThresholdG": 20,
      "highFatThresholdG": 20
    }
  },
  "queue": {
    "mealAnalysis": { "concurrency": 1 },
    "mail": { "concurrency": 3 }
  },
  "cache": {
    "medicineSearchTtlMs": 300000,
    "medicineDetailTtlMs": 900000,
    "medicineSafetyTipsTtlMs": 1800000,
    "asyncJobResultTtlMs": 1800000
  }
}
```

规则：

1. `schemaVersion` 必须受支持；不支持的版本拒绝整次更新。
2. 所有数值字段有明确上下限；温度、并发数、TTL、重试次数不能接受 `NaN`、负数或无界值。
3. 远程配置缺失的字段沿用环境变量解析出的启动值，不把缺字段解释成零值。
4. 更新成功后生成 `configVersion`，由 `revision` 加本地递增序号组成；日志只记录字段名和版本，不记录 prompt 全文、API key 或密码。
5. 远程配置不可用时继续使用最后一份有效快照；应用启动失败不依赖 rnacos 可用性。
6. prompt 可以作为调优项，但必须受长度限制并记录版本/hash；敏感信息和凭据禁止写入配置中心。

## 动态与非动态配置分类

| 类别                       | 第一版处理        | 例子                                                             |
| -------------------------- | ----------------- | ---------------------------------------------------------------- |
| 每次请求读取即可生效       | 热更新            | 餐食视觉 temperature、maxRetries、model 覆盖、匹配阈值、缓存 TTL |
| 已创建对象支持安全变更     | 热更新 + 应用钩子 | BullMQ worker concurrency                                        |
| 需要替换连接或重建基础设施 | 保持启动配置      | `DATABASE_URL`、`REDIS_URL`、rnacos 地址/认证、Cache store 类型  |
| 影响安全边界或进程引导     | 保持启动配置      | JWT/API key、端口、CORS、`OTEL_ENABLED`、模块启停                |

## 实施任务

### Task 1: 固化运行时配置类型、schema 和快照服务

**Files:**

- Create: `src/config/runtime/runtime-config.types.ts`
- Create: `src/config/runtime/runtime-config.schema.ts`
- Create: `src/config/runtime/runtime-config.service.ts`
- Create: `src/config/runtime/runtime-config.service.spec.ts`
- Create: `src/config/runtime/runtime-config.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/config/env/env-keys.enum.ts`
- Modify: `src/config/env/environment.validation.ts`
- Modify: `.env.development.example`
- Modify: `.env.test.example`
- Modify: `.env.production.example`

- [ ] **Step 1: 先写快照服务的失败测试**

测试必须覆盖：

```typescript
it('uses the environment-derived snapshot before a remote source is available');
it('replaces the snapshot atomically after a valid remote update');
it('keeps the last-known-good snapshot after an invalid update');
it('notifies subscribers only after validation succeeds');
it('isolates a subscriber failure from other subscribers');
```

- [ ] **Step 2: 运行目标测试确认失败**

运行：`pnpm test -- runtime-config.service.spec`

预期：测试因运行时配置类型和服务尚未存在而失败；不得修改现有业务实现来绕过失败。

- [ ] **Step 3: 实现最小运行时配置边界**

服务至少通过以下稳定端口提供能力，业务代码不直接接触远程客户端：

```typescript
export interface RuntimeConfigPort {
  getSnapshot(): Readonly<RuntimeConfigSnapshot>;
  getVersion(): string;
  applyRemoteDocument(document: unknown): RuntimeConfigApplyResult;
  subscribe(listener: RuntimeConfigListener): () => void;
}
```

`applyRemoteDocument()` 必须执行“解析 → schema 校验 → 生成新快照 → 替换引用 → 通知订阅者”的顺序；任一步失败都不得污染旧快照。`RuntimeConfigModule` 作为全局模块提供该服务，但不在本任务中连接 rnacos。

- [ ] **Step 4: 增加启动配置开关并运行测试**

增加以下启动配置，默认关闭远程配置：

```text
RNACOS_ENABLED=false
RNACOS_SERVER_URL=http://127.0.0.1:8848
RNACOS_NAMESPACE=development
RNACOS_GROUP=LUCENT_RUNTIME
RNACOS_DATA_ID=lucent-runtime-tuning.json
RNACOS_USERNAME=
RNACOS_PASSWORD=
```

认证字段只从环境变量读取，禁止进入 `RuntimeConfigSnapshot`。运行：

```bash
pnpm test -- runtime-config.service.spec
pnpm typecheck
```

预期：目标测试和类型检查通过；未开启 rnacos 时现有启动行为不变。

### Task 2: 接入 rnacos/Nacos 协议适配器和本地可选服务

**Files:**

- Create: `src/config/runtime/runtime-config-source.ts`
- Create: `src/config/runtime/rnacos-config-source.ts`
- Create: `src/config/runtime/rnacos-config-source.spec.ts`
- Modify: `src/config/runtime/runtime-config.module.ts`
- Modify: `src/config/runtime/runtime-config.service.ts`
- Modify: `docker-compose.dev.yml`
- Modify: `scripts/dev/up-local-stack.ts`
- Modify: `docs/01-reference/environment.md`
- Modify: `docs/01-reference/environment-variables.md`

- [ ] **Step 1: 先验证 rnacos 服务端和客户端协议兼容性**

实现前必须固定以下事实：

1. rnacos 版本、启动方式、配置持久化方式和 HTTP 端口。
2. 使用的 Nacos 客户端库是否支持当前 rnacos 的鉴权、namespace、group、dataId 和长轮询监听。
3. 如果没有满足要求的客户端库，使用 Node.js 24 原生 `fetch` 实现最小适配器，并把 HTTP 请求细节封装在 `rnacos-config-source.ts` 内。

适配器只暴露以下接口，避免业务层绑定具体客户端：

```typescript
export interface RuntimeConfigSource {
  load(): Promise<unknown | null>;
  watch(onDocument: (document: unknown) => Promise<void>): Promise<() => void>;
  close(): Promise<void>;
}
```

- [ ] **Step 2: 为加载、监听、重试和关闭写失败测试**

测试使用假的 HTTP transport 或 Nacos 客户端，不启动真实服务，覆盖：首次加载成功、204/无配置、超时重试、监听得到新文档、监听异常退避、`close()` 取消长轮询、密码不出现在日志。

- [ ] **Step 3: 实现可选远程源**

只有 `RNACOS_ENABLED=true` 时创建远程源。启动时先加载一次，随后进入长轮询；每次收到文档都交给 `RuntimeConfigService.applyRemoteDocument()`。远程源失败只能产生结构化告警并保留本地快照，不得让 API 进程退出。

- [ ] **Step 4: 增加本地可选 rnacos 服务**

在确认上游提供的镜像或二进制发布方式后，把固定版本写入 `docker-compose.dev.yml`，使用独立的 Compose profile 或等价显式开关，避免普通 `pnpm dev:stack` 在用户未需要时自动增加服务。持久化数据使用独立 volume，端口和认证信息不得硬编码到源码。

- [ ] **Step 5: 验证远程更新不重启进程**

手工验证流程：启动 rnacos 和 Lucent，记录 Lucent 进程 PID；发布一份合法配置；确认日志出现新的 `configVersion` 和变更字段，PID 不变，下一次业务调用读取新值。再发布非法配置，确认收到拒绝日志且业务仍使用上一份有效配置。

### Task 3: 先改造餐食识别调优链路

**Files:**

- Modify: `src/modules/daily-records/services/meal-analysis/vision.service.ts`
- Modify: `src/modules/daily-records/services/meal-analysis/vision.service.spec.ts`
- Modify: `src/modules/daily-records/services/meal-analysis/matcher.service.ts`
- Modify: `src/modules/daily-records/services/meal-analysis/matcher.service.spec.ts`
- Modify: `src/llm-runtime/services/llm-runtime.service.ts`
- Modify: `src/llm-runtime/llm-runtime.service.spec.ts`
- Modify: `src/modules/daily-records/services/meal-analysis/worker.service.ts`
- Modify: `src/modules/daily-records/services/meal-analysis/worker.service.spec.ts`
- Modify: `src/modules/daily-records/types/meal-analysis.types.ts`（仅在现有 JSON 诊断类型需要扩展时）

- [ ] **Step 1: 增加“每次调用读取当前快照”的失败测试**

测试必须证明：更新运行时配置后，同一个 singleton `MealAnalysisVisionService` 的下一次调用使用新 temperature、重试次数、model/prompt；同一个 singleton `MealAnalysisMatcherService` 的下一次调用使用新份量和营养阈值。

- [ ] **Step 2: 修改视觉模型创建路径**

保留环境变量提供的 API key 和 base URL；允许运行时快照覆盖 vision model 和非敏感调用参数。`LlmRuntimeService.createChatModel()` 在创建调用级模型时合并当前运行时覆盖值，不缓存旧的 `ChatOpenAI` 实例。

提示词构建函数改为接收经 schema 校验的 prompt 覆盖值；没有覆盖时继续使用代码内默认 prompt。禁止将 API key、完整配置对象或未经脱敏的 prompt 写入普通日志。

- [ ] **Step 3: 修改 matcher 为调用期读取阈值**

删除只在构造函数执行一次的 `private readonly thresholds` 读取方式，改为在 `matchAndEstimate()` 开始时取得当前快照并把一个本地只读阈值对象传给纯函数。这样更新只影响新任务，不会改变正在执行的任务中途的判断。

- [ ] **Step 4: 将调优版本写入可观测诊断**

在餐食分析日志和现有 `matchDiagnostics` 中记录 `runtimeConfigVersion`、模型名和关键非敏感参数摘要；不得记录图片签名 URL、API key、完整 prompt。该版本用于对比同一组标注图片在不同参数下的识别结果。

- [ ] **Step 5: 运行餐食链路测试**

运行：

```bash
pnpm test -- vision.service.spec matcher.service.spec worker.service.spec
pnpm typecheck
```

预期：已有行为测试和动态更新测试全部通过；未开启 rnacos 时结果与环境变量默认值一致。

### Task 4: 增加队列的热更新钩子，先落地 worker concurrency

**Files:**

- Modify: `src/common/queue/queue.factory.ts`
- Modify: `src/common/queue/queue.factory.spec.ts`
- Modify: `src/common/queue/base-async-queue.service.ts`
- Modify: `src/common/queue/base-async-queue.service.spec.ts`
- Modify: `src/mail/mail-queue.service.ts`
- Modify: `src/modules/daily-records/services/meal-analysis/queue.service.ts`
- Modify: `src/common/queue/cron-jobs.service.ts`
- Modify: `src/modules/medicines/services/recognition-queue.service.ts`
- Modify: `src/modules/today-analysis/services/analysis-queue.service.ts`
- Modify: `src/modules/today-suggestion/services/explanation/queue.service.ts`
- Modify: `src/modules/today-suggestion/services/copy/queue.service.ts`
- Modify: `src/modules/reports/services/ai-summary/summary-queue.service.ts`
- Modify: `src/modules/reports/services/clinic-summary/pdf-queue.service.ts`

- [ ] **Step 1: 为队列映射和 worker 并发更新写失败测试**

覆盖：创建队列时读取初始 concurrency、配置更新后只修改对应 worker、未知队列配置不影响其他队列、并发值超出 schema 范围时保持旧值、模块销毁时取消订阅并关闭 worker。

- [ ] **Step 2: 给 `QueueCreateOptions` 增加稳定 runtime key**

将队列名称映射到显式配置键，例如 `mealAnalysis`、`mail`、`todayAnalysis`，不要依赖字符串截断或队列名称的隐式转换。`ManagedQueue` 保存取消订阅函数，避免远程配置更新后留下已销毁 worker 的监听器。

- [ ] **Step 3: 更新已创建 worker 的 concurrency**

创建 worker 时使用快照初始值；运行时更新只对已存在的 `Worker` 设置新的 `concurrency`。不得通过关闭并重建整个 Queue/Worker 来实现普通调优，因为这会引入消费中任务、连接和优雅停机风险。

- [ ] **Step 4: 处理重试、backoff、保留策略的边界**

第一版只承诺 concurrency 热更新。邮件队列的 attempts/backoff/retention 若要热更新，必须改为在每次 `queue.add()` 时解析当前策略并显式传入；不能假设创建 Queue 时传入的 `defaultJobOptions` 会自动改变已创建 Queue 的未来行为。完成该改造前，这些字段继续使用启动期配置，并在文档中标注为重启生效。

- [ ] **Step 5: 验证队列更新**

运行：

```bash
pnpm test -- queue.factory.spec base-async-queue.service.spec
pnpm test -- mail-queue.service.spec meal-analysis/queue.service.spec
pnpm typecheck
```

手工启动一个有 Redis 的运行实例，改变 `mealAnalysis.concurrency`，确认 worker 对后续任务使用新并发，既有队列名、Redis 连接和任务状态不变。

### Task 5: 将缓存 TTL 分层并支持新写入热更新

**Files:**

- Create: `src/common/cache/runtime-cache-policy.service.ts`
- Create: `src/common/cache/runtime-cache-policy.service.spec.ts`
- Modify: `src/config/services/cache.config.ts`（只保持 store/连接的启动期职责）
- Modify: `src/modules/medicines/cache/store.service.ts`
- Modify: `src/modules/medicines/cache/store.service.spec.ts`
- Modify: `src/common/queue/base-async-queue.service.ts`
- Modify: `src/common/queue/base-async-queue.service.spec.ts`

- [ ] **Step 1: 写 TTL 解析失败测试**

测试覆盖：读取当前 TTL、更新后新写入使用新 TTL、旧 key 不被伪装成已刷新、越界 TTL 使用上一份有效策略、没有远程值时继续使用现有常量。

- [ ] **Step 2: 实现按缓存族解析策略**

`RuntimeCachePolicyService` 根据稳定的缓存族 key 返回 TTL；它不创建或替换 Cache store。第一版至少支持 medicine search/detail/safety tips 和异步任务结果缓存。

- [ ] **Step 3: 改造目标缓存写入点**

把 `MEDICINES_*_CACHE_TTL_MS` 和 `DEFAULT_RESULT_TTL_MS` 的直接使用替换为调用期读取策略。对于 share token、验证码、OAuth state、会话和风控缓存，除非额外审查安全语义，否则不纳入普通调优配置。

- [ ] **Step 4: 验证缓存更新语义**

运行：

```bash
pnpm test -- runtime-cache-policy.service.spec store.service.spec base-async-queue.service.spec
pnpm typecheck
```

预期：改变 TTL 后，新写入 key 使用新 TTL；已经写入的 key 不被自动延长或缩短。Redis 地址、内存/Redis store 类型仍然只能通过重启改变。

### Task 6: 完成可观测性、运维文档和配置中心操作边界

**Files:**

- Create: `docs/01-reference/adr/0011-rnacos-runtime-config.md`
- Modify: `src/config/runtime/runtime-config.service.ts`
- Modify: `src/common/logger/lifecycle.service.ts`
- Modify: `src/common/logger/lifecycle.service.spec.ts`
- Modify: `src/common/metrics/metrics.service.ts`
- Modify: `src/common/metrics/metrics.service.spec.ts`
- Modify: `docs/01-reference/environment.md`
- Modify: `docs/01-reference/environment-variables.md`
- Modify: `README.md`
- Modify: `.env.development.example`
- Modify: `.env.test.example`
- Modify: `.env.production.example`
- Append: `docs/02-logs/migration-log/YYYY-MM-DD.md`

- [ ] **Step 1: 增加运行时配置状态日志和指标**

至少记录：远程源启用状态、最近成功版本、最近成功时间、最近失败时间、失败原因摘要、当前配置来源。密码、token、API key、完整 prompt 和连接字符串必须脱敏或不记录。更新日志需能与已有 `trace_id`/`span_id` 共存，但不把配置版本当作 trace ID。

- [ ] **Step 2: 明确降级行为**

rnacos 短暂不可用时保留最后有效快照并告警；超过 5 分钟仍不可用时增加 `runtime_config_stale` 指标和告警，但不因为可选配置中心故障把本地开发或 API readiness 直接判为失败。进程首次启动且没有可用远程配置时使用环境变量和代码默认值。

- [ ] **Step 3: 写 ADR 和操作文档**

ADR 必须记录选择 rnacos 的原因、协议兼容验证结果、热更新/重启边界、回滚方式和为什么不把密钥放进配置中心。环境文档必须给出：启动变量、dataId/group/namespace、发布合法配置、回滚到上一版本、观察 `configVersion`、验证 PID 不变的命令。

- [ ] **Step 4: 更新迁移日志并执行文档检查**

每次实际代码改动都在当天迁移日志追加新章节，不覆盖已有内容。运行：

```bash
pnpm docs:check
pnpm docs:verify
pnpm docs:links
```

### Task 7: 端到端验收与安全回归

**Files:**

- Modify: `src/config/runtime/runtime-config.service.spec.ts`
- Modify: `src/config/runtime/rnacos-config-source.spec.ts`
- Modify: `src/modules/daily-records/services/meal-analysis/vision.service.spec.ts`
- Modify: `src/modules/daily-records/services/meal-analysis/matcher.service.spec.ts`
- Modify: `src/common/queue/queue.factory.spec.ts`
- Modify: `src/common/cache/runtime-cache-policy.service.spec.ts`
- Modify: `docs/01-reference/adr/0011-rnacos-runtime-config.md`

- [ ] **Step 1: 运行范围测试**

```bash
pnpm test -- runtime-config rnacos-config-source vision.service matcher.service queue.factory runtime-cache-policy
```

预期：所有相关测试通过，覆盖合法更新、非法回滚、source 断线恢复、订阅释放、配置脱敏和多个 consumer 同时更新。

- [ ] **Step 2: 运行仓库级检查**

```bash
pnpm lint:check
pnpm format:check
pnpm typecheck
pnpm build
pnpm test:ci
pnpm docs:verify
```

预期：全部通过；如有失败，先判断是本次改动还是已有工作区状态，不能用放宽规则或跳过检查的方式结束。

- [ ] **Step 3: 执行运行时验收**

验收顺序：

1. 使用环境变量启动 Lucent，确认 rnacos 关闭时功能与当前行为一致。
2. 开启 rnacos，发布一份餐食配置，确认不重启进程即可影响下一次餐食分析。
3. 发布非法配置，确认版本不前进、旧配置继续生效、日志包含拒绝原因。
4. 修改餐食 worker concurrency，确认 worker 运行实例更新，不创建第二个同名 worker。
5. 修改缓存 TTL，确认只有之后写入的 key 使用新 TTL。
6. 停止 rnacos，确认应用继续使用最后有效配置并产生告警；恢复 rnacos 后确认监听恢复。
7. 检查日志、指标和餐食诊断中的配置版本可以互相对应，且不存在密钥、签名 URL 或完整 prompt 泄露。

## 回滚方案

1. 远程配置回滚：在 rnacos 控制台恢复上一份合法版本；应用会按同一 dataId/group 重新收到配置。
2. 单个字段回滚：删除该字段，使其回退到环境变量或代码默认值；不使用 `0`、空字符串等隐式回退值。
3. 配置中心故障：保持最后有效快照；必要时把 `RNACOS_ENABLED=false` 并重启，恢复纯环境变量模式。
4. 代码回滚：按任务边界回滚运行时配置接线；数据库 schema 和 API 合同不应因本计划发生变化。

## 明确不在本次第一版承诺的内容

- 不动态修改 `DATABASE_URL`、`REDIS_URL`、Cache store、rnacos 地址或认证凭据。
- 不动态修改 API key、JWT secret、OAuth secret、COS secret 或其他凭据。
- 不通过重建 Queue/Worker 来实现普通并发调优。
- 不把所有现有缓存常量一次性搬进配置中心；先覆盖已确认有调优价值且安全语义清晰的缓存族。
- 不把“可动态调参”当成“食品识别质量必然提升”。质量提升仍需固定图片集、人工标注、模型/提示词版本和结果指标进行 A/B 对比。

## 实施前参考资料

- rnacos 官方仓库：[nacos-group/r-nacos](https://github.com/nacos-group/r-nacos)
- Nacos 配置概览：[Configuration Management](https://nacos.io/en/docs/next/manual/user/config/overview/)
- Nacos Open API：[Open API](https://nacos.io/en/docs/v1/open-api/)
- BullMQ worker 并发：[Concurrency](https://docs.bullmq.io/guide/workers/concurrency)
