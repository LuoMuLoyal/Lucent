# BullMQ 队列服务加固计划（未完成部分）

## 背景

2026-08-01 对 Lucent 全部 BullMQ 队列（8 个业务队列 + 2 个 cron 队列）做了全面检查，
发现 3 个高优先级问题（重试失效、IDOR、失败后无法重试）和 4 个中优先级问题
（缓存路径依赖、enqueue 异常未兜底、调度去重非原子、Redis URL 解析不完整）。
本计划按 Phase 逐项修复，每项含改动点与验证方式。

> 进度说明（2026-08-03 更新）：**Phase 1（P1-1 重试生效）、Phase 2（P1-2
> TodayAnalysis IDOR）、Phase 4（P2-4 pollStatus 缓存路径）已实施**（代码已含
> `attemptsMade` 重试逻辑、`user.sub` 透传与缓存 userId 校验）。
> 本文件仅保留**未实施**的 Phase 3（P1-3）、Phase 5（P2-5）、Phase 6（P2-6/P2-7/P3-8）
> 及对应设计决策。

## 未实施问题清单

| #    | 严重级 | 问题                                                                                              | 位置                                               |
| ---- | ------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| P1-3 | 高     | `MealAnalysis` 确定性 jobId（`recordId:revision`）导致失败 job 在保留期内（7 天）无法重新入队重试 | `meal-analysis/queue.service.ts`                   |
| P2-5 | 中     | `enqueueOrFallback` 与各 `enqueue()` 未捕获运行时异常（Redis 配置但断连），直接 500 而非同步回退  | `common/helpers/infra/queue-helpers.ts`            |
| P2-6 | 中     | Reminder 调度 `findFirst + create` 去重非原子，重叠 tick 依赖唯一约束兜底                         | `medicine-reminders/services/scheduler.service.ts` |
| P2-7 | 低     | Redis URL 手写解析忽略 query 参数（AWS Elasticache 等 `?family=0`）                               | `queue.factory.ts` / `cache.config.ts`             |
| P3-8 | 低     | `mailConfig?.queue.workerConcurrency` 可选链不对称，queue 缺失会 TypeError                        | `mail-queue.service.ts`                            |

---

## 设计决策

### D3（P1-3）：MealAnalysis 去掉确定性 jobId，幂等交给 worker

- `enqueue` 不再传 `jobId`（BullMQ 自动生成），同一 `recordId:revision` 的重复 enqueue 会产生冗余 job，但 worker 入口已有 `mealSourceRevision !== sourceRevision → return` 幂等检查，旧 revision 的 job 会被安全跳过。
- 失败后同 revision 再次 enqueue 可正常重试，无需等 revision 变化。
- 若后续需要「窗口期去重」，改用 BullMQ `deduplication: { id, ttl }` 而不是固定 jobId。

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

## Phase 拆解（未实施）

### Phase 3 — MealAnalysis 重试可用（P1-3）

改动：

1. `src/modules/daily-records/services/meal-analysis/queue.service.ts`：删除 `jobId` 选项。
2. 确认 worker 幂等检查（`worker.service.ts` L54-61）已覆盖重复 job 场景；补注释说明「去重由 worker 幂等承担」。
3. 更新 `queue.service.spec.ts`（enqueue 调用断言中去掉 jobId）。

验证：`pnpm vitest run src/modules/daily-records/services/meal-analysis`。

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

手工冒烟（Redis 可用环境）：meal 记录上传后同 revision 重试可恢复分析；
模拟 Redis 断连观察 enqueue 回退到同步处理。

## 完成标准（未完成项）

- MealAnalysis 失败后无需改记录即可重试。
- enqueue 在 Redis 断连时不 500，回退同步处理（或按队列语义记录错误不静默丢任务）。
- Reminder 调度去重原子化（多实例部署前必须完成）。
- Redis URL 解析支持 query 参数（或文档明确约束）。
- 队列 spec 全绿，无回归。
