# BullMQ 队列服务加固计划

## 背景

2026-08-01 对 Lucent 全部 BullMQ 队列（8 个业务队列 + 2 个 cron 队列）做了全面检查，
发现 3 个高优先级问题（重试失效、IDOR、失败后无法重试）和 4 个中优先级问题
（缓存路径依赖、enqueue 异常未兜底、调度去重非原子、Redis URL 解析不完整）。
本计划按 Phase 逐项修复，每项含改动点与验证方式。

## 问题清单

| #    | 严重级 | 问题                                                                                                                         | 位置                                                         |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| P1-1 | 高     | `BaseAsyncQueueService.processJob` 吞掉异常，job 在 BullMQ 侧记为 completed，`attempts: 3 + backoff` 对 6 个异步队列永不生效 | `src/common/queue/base-async-queue.service.ts`               |
| P1-2 | 高     | `TodayAnalysis` 状态轮询未传 `userId`，无所有权校验（其他 5 个异步队列都有）                                                 | `today-analysis.controller.ts` / `analysis-queue.service.ts` |
| P1-3 | 高     | `MealAnalysis` 确定性 jobId（`recordId:revision`）导致失败 job 在保留期内（7 天）无法重新入队重试                            | `meal-analysis/queue.service.ts`                             |
| P2-4 | 中     | `pollStatus` 缓存命中时仍调 `queue.getJob()` 做归属校验，依赖 Redis job 存在性                                               | `base-async-queue.service.ts`                                |
| P2-5 | 中     | `enqueueOrFallback` 与各 `enqueue()` 未捕获运行时异常（Redis 配置但断连），直接 500 而非同步回退                             | `common/helpers/infra/queue-helpers.ts`                      |
| P2-6 | 中     | Reminder 调度 `findFirst + create` 去重非原子，重叠 tick 依赖唯一约束兜底                                                    | `medicine-reminders/services/scheduler.service.ts`           |
| P2-7 | 低     | Redis URL 手写解析忽略 query 参数（AWS Elasticache 等 `?family=0`）                                                          | `queue.factory.ts` / `cache.config.ts`                       |
| P3-8 | 低     | `mailConfig?.queue.workerConcurrency` 可选链不对称，queue 缺失会 TypeError                                                   | `mail-queue.service.ts`                                      |

已核实**非问题**：`removeJobScheduler` 对不存在的 scheduler 幂等（Lua 返回 1 不抛错）；
优雅停机链路（worker→queue close）正确；job 保留策略合理。

---

## 设计决策

### D1（P1-1）：让 BullMQ 原生重试真正生效，末次失败再缓存

**方案**：不再在 `processJob` 里无条件吞异常，改为「可重试错误抛出 → BullMQ backoff 重试；最后一次尝试失败 → 缓存失败结果」。

- `QueueCreateOptions.processor` 回调入参从 `{ id, name, data }` 扩展为携带 `attemptsMade` 与 `opts`（在 `queue.factory.ts` 的 worker 处理器中把完整 `job` 传入）。
- `processJob` 在 catch 中判断：`job.attemptsMade + 1 < attempts` 时 `throw`（交给 BullMQ 重试，期间轮询返回 `pending`/`delayed`）；已达最大次数时缓存 `{ status: 'failed', error }` 并返回，行为与现状一致。
- 重试次数来源：优先从 job 的 `opts.attempts` 读取；`DEFAULT_QUEUE_OPTIONS.attempts` 保持 3 不变。
- 轮询语义不变：`pollStatus` 慢路径已能区分 `delayed`/`active`/`failed`。

**不改**：结果缓存语义、`DEFAULT_RESULT_TTL_MS`、各子类签名（`processJob` 为 protected，调用方仍是子类构造函数）。

### D2（P1-2）：补齐 TodayAnalysis 轮询归属校验

与其余 5 个异步队列对齐：`TodayAnalysisQueueService.getStatus(jobId, userId)` 把 `userId` 传给 `pollStatus`，controller 传 `user.sub`。

### D3（P1-3）：MealAnalysis 去掉确定性 jobId，幂等交给 worker

- `enqueue` 不再传 `jobId`（BullMQ 自动生成），同一 `recordId:revision` 的重复 enqueue 会产生冗余 job，但 worker 入口已有 `mealSourceRevision !== sourceRevision → return` 幂等检查，旧 revision 的 job 会被安全跳过。
- 失败后同 revision 再次 enqueue 可正常重试，无需等 revision 变化。
- 若后续需要「窗口期去重」，改用 BullMQ `deduplication: { id, ttl }` 而不是固定 jobId。

### D4（P2-4）：缓存命中路径不依赖 Redis job

- `processJob` 写入缓存时，从 `job.data.userId` 提取 userId 一并存入 `AsyncJobResult`（新增可选字段 `userId`）。
- `pollStatus` 缓存命中且传入 userId 时，直接用缓存内 userId 比对，不再调用 `queue.getJob()`。
- 慢路径的 `job.data.userId` 校验保持不变。

### D5（P2-5）：enqueue 异常回退到同步执行

- `enqueueOrFallback`：`try { jobId = await enqueue() } catch` → 记 error 日志（含队列名），走 fallback。
- `MailQueueService.enqueue`、`MealAnalysisQueueService.enqueue`、`DataExportQueueService.enqueue` 同样加 try-catch 回退（mail/meal 回退到直接处理；data-export 无同步等价物则记 error 后抛出，避免静默丢任务——按各队列现状决定）。

### D6（P2-6，可选）：Reminder 去重原子化

- 用 `createMany({ data, skipDuplicates: true })` 替换 `findFirst + create`，DB 层原子去重。
- 保持「先发通知、后写记录」顺序不变（保证失败可重试）。
- 单实例部署下非紧急；多实例部署前必须完成（或在 ADR 中记录「至少一次投递」语义）。

### D7（P2-7，可选）：统一 Redis URL 解析

- 抽一个共享解析函数（`src/common/helpers/infra/redis-url.ts`）供 `queue.factory.ts` 与 `cache.config.ts` 使用，支持 query 参数（`family`、`db` 覆盖、TLS）。
- 或最低限度：在 env 校验注释/文档中明确「仅支持 `pathname` 指定 db，不支持 query」。

### D8（P3-8）：`mailConfig?.queue?.workerConcurrency ?? 3` 补全可选链。

---

## Phase 拆解

### Phase 1 — 异步队列重试生效（P1-1）

改动：

1. `src/common/queue/queue.factory.ts`
   - `QueueCreateOptions.processor` 入参类型加 `attemptsMade`、`opts`；worker 处理器传完整 job。
   - `DEFAULT_QUEUE_OPTIONS` 注释同步更新。
2. `src/common/queue/base-async-queue.service.ts`
   - `processJob` 改为「末次失败才缓存」逻辑；缓存值增加 `userId` 字段（为 Phase 4 铺垫）。
3. 更新 `queue.factory.spec.ts`、`base-async-queue.service.spec.ts` 中受签名影响的用例。

验证：

- `pnpm vitest run src/common/queue`（或 `pnpm test` 全量）
- `pnpm typecheck && pnpm lint:check`

### Phase 2 — TodayAnalysis IDOR（P1-2）

改动：

1. `src/modules/today-analysis/services/analysis-queue.service.ts`：`getStatus(jobId, userId)` 透传 `pollStatus`。
2. `src/modules/today-analysis/today-analysis.controller.ts`：`generateStatus` 传 `user.sub`。
3. 更新 `analysis-queue.service.spec.ts`、`today-analysis.controller.spec.ts`。

验证：同上。

### Phase 3 — MealAnalysis 重试可用（P1-3）

改动：

1. `src/modules/daily-records/services/meal-analysis/queue.service.ts`：删除 `jobId` 选项。
2. 确认 worker 幂等检查（`worker.service.ts` L54-61）已覆盖重复 job 场景；补注释说明「去重由 worker 幂等承担」。
3. 更新 `queue.service.spec.ts`（enqueue 调用断言中去掉 jobId）。

验证：`pnpm vitest run src/modules/daily-records/services/meal-analysis`。

### Phase 4 — pollStatus 缓存路径优化（P2-4）

改动：

1. `base-async-queue.service.ts`：`AsyncJobResult` 增加 `userId?`；`processJob` 写入时带上；`pollStatus` 缓存命中直接用缓存值校验。
2. 更新 `base-async-queue.service.spec.ts`（新增：job 已从 Redis 清理但缓存有效时仍返回结果；userId 不匹配返回 null）。

验证：`pnpm vitest run src/common/queue/base-async-queue.service.spec.ts`。

### Phase 5 — enqueue 容错（P2-5）

改动：

1. `src/common/helpers/infra/queue-helpers.ts`：try-catch enqueue，失败走 fallback。
2. `src/mail/mail-queue.service.ts`：enqueue try-catch 回退到 `transport.send`。
3. `src/modules/daily-records/services/meal-analysis/queue.service.ts`：enqueue 异常回退到 worker 直处理。
4. 更新对应 spec。

验证：`pnpm vitest run src/common/helpers/infra src/mail src/modules/daily-records/services/meal-analysis`。

### Phase 6 — 可选优化（P2-6 / P2-7 / P3-8）

- P2-6：Reminder `createMany({ skipDuplicates: true })` + spec 更新。
- P2-7：抽 `redis-url.ts` 共享解析（或仅文档声明约束）。
- P3-8：补全可选链。

---

## 回归验证

```bash
pnpm test              # 全量单测
pnpm test:e2e          # e2e
pnpm typecheck
pnpm lint:check
```

手工冒烟（Redis 可用环境）：依次触发 `today-analysis/generate/async` → 轮询状态；
模拟 LLM 5xx 观察 job 是否按 backoff 重试、末次失败后轮询返回 `failed`；
meal 记录上传后同 revision 重试可恢复分析。

## 完成标准

- 6 个异步队列在 LLM 瞬时故障时可自动重试，末次失败缓存失败结果。
- 所有异步轮询接口均有 userId 归属校验。
- MealAnalysis 失败后无需改记录即可重试。
- 队列 spec 全绿，无回归。
