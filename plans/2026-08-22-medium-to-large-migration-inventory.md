# Lucent 中小型到中大型过渡迁移盘点与执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 找出 Lucent 已经进入中大型复杂度后，仍停留在早期项目做法的工程边界，并按依赖关系形成可验证的迁移队列。

**Architecture:** 保留模块化单体和单仓 Prisma 迁移体系，不以拆微服务为目标。优先把配置、错误、队列、事件、持久化访问和 API 发布边界做深，让故障、变更和验证集中在少数稳定接口后面。

**Tech Stack:** NestJS 11、Fastify、Prisma 7、PostgreSQL/pgvector、Redis/BullMQ、neverthrow、OpenAPI、Vitest、Docker Compose、OpenTelemetry、Prometheus。

---

## 一、审查结论

审查快照：2026-08-22。当前 Lucent 已经不是需要“引入模块化”的小项目：Prisma schema 已拆到 `prisma/models/`，HTTP 错误已经进入 RFC 9457/Problem Details 窗口，代码中已经有 reader port、BullMQ 基础队列、OTel 和 Prometheus。现在最值得迁移的是“运行时可靠性和变更发布边界”，不是再次大规模改目录。

### 已有独立计划，不在本计划重复拆解

| 项目                   | 当前状态                                                                                                                                                   | 本计划处理方式                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| BullMQ Worker 进程分离 | 已有 [`2026-07-24-worker-separation-and-cron-repeatable.md`](2026-07-24-worker-separation-and-cron-repeatable.md)，但源码中尚未形成 `WORKER_MODE` 运行路径 | 作为 P0/P1 现有计划继续执行；本计划补充它与事件、队列运维的依赖            |
| rnacos 运行时调参      | 已有 [`2026-08-02-rnacos-runtime-config-tuning.md`](2026-08-02-rnacos-runtime-config-tuning.md)；这是动态调参，不等于静态配置迁移                          | 与本计划的 YAML 配置加载分开，先完成静态配置边界，再决定是否引入运行时中心 |
| 可观测性轻量化         | 已有 `docs/01-reference/observability-lightweight-research.md`，尚未改 Compose                                                                             | 按 benchmark 结果决定，不把"换监控栈"当作无证据的立即重构                  |

### 候选迁移总表

| 优先级 | 迁移项                         | 当前证据                                                                                            | 目标                                                                                          | 依赖                     |
| ------ | ------------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------ |
| P0/P1  | API 与 Worker 进程分离         | BullMQ 队列和 cron 已集中在 API 进程；已有进程分离计划但代码尚未完全接线                            | API、Worker、cron 可独立重启和扩容，部署时有健康探针和回滚顺序                                | 队列幂等                 |
| P1     | 事务内事件与持久化 Outbox      | `EventEmitterModule`/`@OnEvent` 仍是进程内投递；事件驱动 Today、Suggestion、风险检查和缓存失效      | 写入和事件记录同事务，队列消费者可重试、去重、恢复，应用重启不丢事件                          | Worker 分离、数据库迁移  |
| P1     | 持久化访问与跨模块数据边界收口 | 生产代码仍有多处服务直接注入 `PrismaService`；已有 reader port，但例外和写入边界需逐项清理          | owner module 负责写入；跨模块读取走 reader port/只读投影；read-model 例外有清单和静态门禁     | 事务策略                 |
| P1     | 队列运行合同与运维闭环         | `BaseAsyncQueueService` 统一了 enqueue/poll/cache，但队列重试、失败保留、重放和幂等仍分散在业务服务 | 统一 job envelope、attempt/backoff/DLQ/replay/idempotency/metrics，且 Worker/API 分离后可诊断 | Worker 分离、Outbox      |
| P1     | 跨仓 API 合同发布流水线        | OpenAPI 导出与 Flutter client bootstrap 仍是本地顺序；Luminous CI 不 checkout Lucent                | 版本化合同、兼容性 diff、生成客户端漂移检查、可回滚的发布顺序自动化                           | —                        |
| P1     | 数据库迁移与发布治理           | 当前已有约 55 个 Prisma migration；部署需停止 Worker、迁移、再启动新进程                            | expand/contract、升级库验证、备份恢复演练、破坏性迁移检查和 schema drift 门禁                 | Worker 分离、部署文档    |
| P2     | 可观测性栈瘦身                 | 生产 Compose 默认包含 Prometheus、Grafana、多个 exporter；应用指标/OTel 已在进程内                  | 先测量，再选择精简 Prometheus、VictoriaMetrics 或托管 agent；保留可行动指标                   | 部署基线、告警清单       |
| P2     | API 版本与弃用策略             | 路由已有 `/api/v1`，但 v2、兼容窗口、deprecation headers 仍是 Roadmap 项                            | 把版本、合同兼容、客户端最低版本和弃用窗口写成可执行策略                                      | 跨仓合同流水线           |
| P2     | 多实例运行门禁                 | 当前部署仍按单实例假设；TODO 已注明需验证多实例限流                                                 | 在真的需要水平扩展前，补 Redis 限流、session、cache、cron、事件和 tracing 的多实例验证        | Worker、Outbox、可观测性 |

结论：当前最急的不是 API v2 或拆微服务，而是事件/队列可靠性和跨仓合同。没有这些边界，继续增加功能会把运行时复杂度分散到更多调用方。

## 二、执行计划

### Task 1: 完成 API/Worker 进程分离，并补队列运行合同

**Files:**

- Continue: `plans/2026-07-24-worker-separation-and-cron-repeatable.md`
- Modify: `src/main.ts`, `src/common/queue/queue.factory.ts`, `src/common/queue/base-async-queue.service.ts`, `src/common/queue/cron-jobs.service.ts`
- Modify: all queue services under `src/modules/**` and `src/mail/mail-queue.service.ts`
- Modify: `deploy/compose.yml`, `deploy/deploy.ts`, `deploy/smoke.ts`, `deploy/prometheus/`
- Test: queue factory/base service/worker probe tests and staging smoke checks

- [ ] 先落地 `WORKER_MODE=api|worker`，验证未设置时保持当前 `full` 行为；API 进程只 enqueue/poll，Worker 进程消费和注册 repeatable cron。
- [ ] 为 Worker 暴露独立 liveness/readiness/metrics probe；部署顺序固定为停止 Worker → 停止 API → migrate → 启动 API 并过健康门 → 启动 Worker。
- [ ] 为每个 job 定义稳定的 job name、payload version、attempt、backoff、retention 和幂等 key；业务 processor 必须能安全重复执行。
- [ ] 增加 failed job 查询、人工 replay、过期清理和 queue depth/failed/stalled 指标。重放必须记录 operator reason 和原 job id，不允许复制出无界 job。
- [ ] 验证 API、Worker、Redis 中断、优雅停机、迁移期间和回滚镜像场景；运行现有 queue tests 加 `pnpm typecheck`、`pnpm build` 和 staging smoke。

**完成判据：** API 和 Worker 可独立重启，Redis 暂时不可用时 API 不启动不可控的 Worker；长任务失败能定位、重试或人工重放，cron 不会因 API 多实例重复注册。

### Task 2: 把进程内领域事件迁移为事务 Outbox

**Files:**

- Modify: `prisma/models/platform.prisma` 或新建归属明确的 outbox model 文件
- Create: `src/common/events/outbox.repository.ts`, `src/common/events/outbox.dispatcher.ts` 及对应测试
- Modify: `src/common/events/domain-events.ts`
- Modify: owner services that currently emit `EventEmitter2` events, including health events, daily records, dose logs, reminders, health context, settings and suggestion materialization
- Modify: `src/app.module.ts`, `src/common/queue/`
- Test: transaction rollback, dispatcher retry, dedupe, ordering-key and restart recovery tests

- [ ] 先列出每个事件的 source write、事务边界、消费者、幂等 key、是否允许丢失；不把所有 `EventEmitter2` 事件一口气转成公共领域总线。
- [ ] 在 source write 同一 Prisma transaction 中写入 outbox row；事务失败时事件不可见，事件写成功但消费者失败时可重试。
- [ ] 用 BullMQ dispatcher 批量投递 outbox，记录 `attempts`、`availableAt`、`lockedAt`、`lastError` 和 `processedAt`；消费者用现有 materialization/version/unique constraint 做幂等。
- [ ] 保留进程内 `EventEmitter2` 仅用于明确的同进程 UI/缓存通知，并在代码注释中说明其丢失语义；跨进程 recompute、风险检查和异步副作用必须走 outbox/queue。
- [ ] 先迁移 Today/Suggestion recompute，再迁移风险检查和缓存失效；每个批次完成后做一次数据库升级、回滚和重复投递测试。

**完成判据：** 应用重启、Worker 重启或 Redis 短暂不可用不丢掉已提交的必要事件；同一事件重复投递不会重复写业务结果；事件消费者失败不会静默吞掉。

### Task 3: 收口 Prisma 所有权、reader port 和事务边界

**Files:**

- Inspect/Modify: direct `PrismaService` consumers under `src/modules/**`
- Extend: existing repositories under `src/modules/**/repositories/`
- Extend: module root barrels `src/modules/*/index.ts`
- Modify: `src/common/helpers/prisma/`
- Create: architecture dependency check under `scripts/` and its test
- Update: `docs/01-reference/architecture.md`, ADR-0009, `docs/01-reference/how-to/add-new-module.md`

- [ ] 把生产路径逐项分类为 owner write、owner read、cross-module read-model、migration/import/admin/test；不要按正则统计直接批量改名。
- [ ] owner module 的写入统一进入 repository/service，并把事务、软删除、ownership 和并发约束放在该接口后；消费者不得拼接别人的 Prisma query DSL。
- [ ] cross-module 普通读取使用已有 reader port/事实 DTO；Today/Reports 等 read-model 例外必须登记为只读聚合查询，不扩散为写入例外。
- [ ] 为 module dependency 规则增加可执行检查：禁止 feature A 直接使用 feature B 的 Prisma model；允许项只能来自显式 allowlist，并在新增违规时 CI 失败。
- [ ] 迁移一条领域链路后运行对应 unit/e2e/contract 测试，再扩大到所有 owner write；最后运行 `pnpm typecheck`、`pnpm test:ci` 和 `pnpm docs:verify`。

**完成判据：** 跨模块关系通过少量、稳定、可测试的 port；数据库实现变化不会迫使多个模块同时修改；read-model 例外可审计而不是靠口头约定。

### Task 4: 把 OpenAPI/Flutter client 变成跨仓发布门

**Files:**

- Modify: `scripts/contract/export-openapi.ts`, `package.json`, `.github/workflows/lucent-ci.yml`
- Modify: `Luminous/scripts/bootstrap_generated_sources.dart`, `Luminous/scripts/verify_lucent_openapi_sync.dart`, `Luminous/.github/workflows/luminous-ci.yml`
- Modify: `docs/openapi.json`, `docs/01-reference/contracts/`, `Luminous/docs/00-current/Lucent_Contract_Snapshot.md`
- Test: contract compatibility and generated client drift checks

- [ ] 固定合同产物的来源 commit/version；每次 controller/DTO/Problem Details/SSE 改动同时导出 OpenAPI，并记录生成器版本和命令。
- [ ] 在 Lucent CI 增加 schema lint、breaking-change diff 和 Problem Details/SSE contract tests；把“生成成功”与“向后兼容”分开判断。
- [ ] 在 Luminous CI 对同一合同产物执行 bootstrap、生成客户端 drift check 和最小 compile/analyze；失败时显示合同版本而不是只显示生成器错误。
- [ ] 定义发布顺序：Luminous 先兼容新错误/资源形状 → Lucent 发布合同 → Luminous 更新生成客户端 → 删除旧兼容代码；每一步有回滚点。
- [ ] 运行双仓的合同、生成、analyze/typecheck/build 检查；不得手改 generated client 或把本地未发布 OpenAPI 当作稳定合同。

**完成判据：** API 改动在合并前能检测破坏性变化和客户端漂移；两仓库能追溯“客户端代码来自哪个 OpenAPI 版本”。

### Task 5: 建立数据库迁移和发布安全门

**Files:**

- Modify: `.github/workflows/lucent-ci.yml`
- Modify: `deploy/deploy.ts`, `deploy/smoke.ts`, `docs/01-reference/deployment.md`
- Create: migration validation helper and upgrade-fixture tests under `scripts/`/`test/`
- Update: `docs/01-reference/how-to/restore-database-backup.md`, `docs/01-reference/architecture.md`

- [ ] CI 在空库和最近版本 fixture 上分别执行 `prisma migrate deploy`，并检查生成 client、schema 与 migration 是否一致。
- [ ] 对 rename/drop/type narrowing 等破坏性变更强制采用 expand/contract：先加兼容字段/索引，回填并切读写，再在单独发布删除旧结构。
- [ ] 部署前检查备份新鲜度、磁盘余量、migration lock 和 Worker 是否停止；部署后用 smoke 验证关键读写与队列。
- [ ] 至少演练一次“备份 → migration → 失败回滚/恢复 → API/Worker 启动”，记录恢复时间目标和数据丢失窗口；不要把 down migration 当作唯一回滚策略。
- [ ] 为生产迁移写 ADR 或更新 deployment reference；当前任务只建立门禁，不重写历史 migration。

**完成判据：** 新 migration 经过 fresh/upgrade 两类验证；生产部署不会在 Worker 仍使用旧 schema 时切换；恢复路径有命令、前置条件和可观察结果。

### Task 6: 按实测结果瘦身可观测性栈，并准备 API 版本策略

**Files:**

- Inspect/Modify: `deploy/compose.yml`, `deploy/prometheus/`, `deploy/grafana/`, `deploy/alertmanager/`
- Inspect: `src/common/metrics/`, `src/tracing.ts`, `src/common/logger/`
- Update: `docs/01-reference/observability-lightweight-research.md`, ADR-0006/0010, deployment docs
- Later: API version/deprecation docs and OpenAPI config after a separate ADR

- [ ] 先采集同一负载下应用 P95/P99、event loop、OOM、磁盘增长、active series、scrape duration、队列积压和告警延迟。
- [ ] 只将有行动价值的应用指标设为必留；Grafana、Postgres/Redis exporter、node exporter 和 retention 变更先做可回滚 profile，不直接删除。
- [ ] 对 VictoriaMetrics 单机和托管 agent 分别验证查询、告警、备份、断网缓冲、认证、成本和退出路径；未完成 benchmark 前保留当前生产默认栈。
- [ ] 在单独 ADR 中定义 `/api/v1` 的兼容窗口、deprecation headers、最低客户端版本、OpenAPI 文档版本和删除条件；没有实际 v2 consumer 前不复制一套 v2 路由。

**完成判据：** 监控栈更轻但不丢失 HTTP/队列/LLM/主机关键告警；API 版本策略可供合同流水线和客户端发布使用。

## 三、推荐顺序与暂停条件

1. 完成 API/Worker 分离，同时固化 job envelope、幂等和失败重放。
2. 以数据库 transaction + Outbox 改造跨进程事件。
3. 收口 Prisma owner/reader port，并接入静态依赖门禁。
4. 自动化 OpenAPI/Flutter client 发布和兼容性检查。
5. 增加数据库 migration/backup 发布门。
6. 最后根据实测决定观测栈与 API 版本策略。

暂停条件：若某一步需要引入多租户、微服务、Kubernetes、远程配置中心或真实支付等新的产品/部署前提，先创建独立 ADR 和子计划；不得把这些前提偷偷塞进本迁移计划。

## 四、明确不建议现在迁移

- 不把 NestJS 模块化单体拆成微服务；当前模块边界和单人运维条件不足以证明拆分收益。
- 不把 Prisma schema 拆成多个数据库或多个 Prisma Client；当前多文件 schema 已解决主要可维护性问题。
- 不把所有普通配置都复制到 `process.env`，也不把 Secret 放入版本控制的 YAML。
- 不为了“函数式”消除所有 `throw`、SSE error、取消和协议不变量异常。
- 不在没有真实多租户需求前引入 tenant_id 全库改造。
- 不在没有 benchmark、备份和告警替代方案前直接删除 Prometheus/Grafana/exporter。

## 五、验证总门

每个代码迁移子计划完成后至少运行与范围匹配的检查；跨模块、配置、数据库、队列或 API 合同变更必须扩大到：

```powershell
pnpm lint:check
pnpm format:check
pnpm typecheck
pnpm typecheck:tools
pnpm build
pnpm test:ci
pnpm test:e2e:ci
pnpm docs:verify
pnpm docs:links
```

计划执行过程中只更新当前事实文档和当天迁移日志；执行完的计划文件按 Lucent 规则删除，不在计划中留下完成标记。
