# BullMQ Worker 分离 + @Cron → Repeatable 迁移计划

## 背景

当前所有 BullMQ worker（9 个队列）和 3 个 `@Cron` 定时任务都在 API 进程内运行。
PDF 生成等 CPU 密集任务与 HTTP 请求处理共享同一个 event loop；LLM 类任务虽是
I/O 密集（等待 LLM API），但高并发下同样占用内存与 event loop 调度资源，
在队列高峰时可能拖慢 API 响应。分离的核心收益是资源隔离与独立扩缩容。

ADR-0004 已规划"未来将 worker 拆到独立进程/容器"。本计划执行该规划，并将
`@Cron` 迁移到 BullMQ Repeatable Job，为未来多 worker 实例消除定时任务重复触发问题。

## 现状清单

### BullMQ 队列（9 个）

| 队列名                       | 并发     | Base 类                 | CPU 密集?             | 队列服务文件                                               |
| ---------------------------- | -------- | ----------------------- | --------------------- | ---------------------------------------------------------- |
| `lucent-mail`                | 3 (可配) | 直连                    | 否 (SMTP I/O)         | `mail/mail-queue.service.ts`                               |
| `lucent-meal-analysis`       | 1        | 直连                    | 是 (LLM vision)       | `daily-records/services/meal-analysis/queue.service.ts`    |
| `data-export`                | 1        | 直连                    | 中 (DB 查询 + 序列化) | `data-export/services/queue.service.ts`                    |
| `medicine-recognition`       | 1        | `BaseAsyncQueueService` | 是 (LLM vision)       | `medicines/services/medicine-recognition-queue.service.ts` |
| `today-analysis`             | 2        | `BaseAsyncQueueService` | 是 (LLM)              | `today-analysis/services/analysis-queue.service.ts`        |
| `suggestion-explanation`     | 2        | `BaseAsyncQueueService` | 是 (LLM)              | `today-suggestion/services/explanation/queue.service.ts`   |
| `suggestion-copy-generation` | 3        | `BaseAsyncQueueService` | 是 (LLM)              | `today-suggestion/services/copy/copy-queue.service.ts`     |
| `report-summary`             | 2        | `BaseAsyncQueueService` | 是 (LLM)              | `reports/services/ai-summary/summary-queue.service.ts`     |
| `clinic-summary-pdf`         | 1        | `BaseAsyncQueueService` | 是 (PDF)              | `reports/services/clinic-summary/pdf-queue.service.ts`     |

> 注：`BaseAsyncQueueService` 实际有 **6** 个子类（源码注释写的 "5" 已过时，
> Phase 5 一并修正）；ADR-0004 写的 "All 7 BullMQ queue workers" 同样过时（实际 9 个）。

### @Cron 定时任务（3 个）

| 服务                       | Cron 表达式   | 调度       | 幂等?                              | 方法（均已 public）        | 文件                                                |
| -------------------------- | ------------- | ---------- | ---------------------------------- | -------------------------- | --------------------------------------------------- |
| `LifecycleService`         | `*/5 * * * *` | 每 5 分钟  | 是 (`updateMany` WHERE 子句防重复) | `refreshLifecycleStates()` | `today-suggestion/services/lifecycle/service.ts`    |
| `ReminderSchedulerService` | `* * * * *`   | 每分钟     | 是 (DB 唯一 delivery 记录去重)     | `dispatchDueReminders()`   | `medicine-reminders/services/scheduler.service.ts`  |
| `DataRetentionService`     | `0 3 * * *`   | 每日 03:00 | 是 (deleteMany 幂等)               | `cleanupExpiredData()`     | `data-retention/services/data-retention.service.ts` |

> **时区注意**：现有 `@Cron` 未指定 timezone，使用进程时区（生产容器
> node:24-alpine 默认 UTC，所以 `0 3 * * *` 即 UTC 03:00；本地开发则按本地时区）。
> 迁移到 BullMQ Repeatable 时统一显式固定 `tz: 'UTC'`（见 D3），生产行为不变，
> 本地开发的触发时刻会与现状不同——属可接受的行为统一。

> `ReminderSchedulerService` 额外有进程内 `isDispatching` 重入保护。迁移后可删除，
> 但理由必须写对：**BullMQ 只保证同一个 job 实例不被多个 worker 并发消费，并不阻止
> 相邻两次 repeat 实例重叠**（上一次执行超过间隔时，下一个实例仍会按时触发）。该任务
> 的重叠执行由 DB 唯一 delivery 记录幂等兜底，因此 guard 可安全删除；若未来任务不再
> 幂等，需改用 Redis 分布式锁而不是恢复进程内 guard。

### 基础设施

- `BullmqQueueFactory`（`src/common/queue/queue.factory.ts`）：`createQueue()` 同时
  创建 Queue + Worker + metrics poll（30s 轮询 `getJobCounts` 上报 Prometheus），
  返回 `{ queue, worker }`（均可为 null——REDIS_URL 未配置时已返回双 null）。
  factory 已实现 `OnModuleDestroy`：依次 clearInterval → `worker.close()` →
  `queue.close()`，由 `main.ts` 的 `app.enableShutdownHooks()` 在 SIGTERM 时触发，
  **优雅停机链路已存在，无需新建**。
- `BaseAsyncQueueService`（`src/common/queue/base-async-queue.service.ts`）：6 个
  异步队列的基类；`this.queue` 已显式声明为 `Queue | null`，`isConfigured` /
  `pollStatus` 均有 null guard（`pollStatus` 在 `queue: null` 时返回 `null` 不崩溃）。
- `ScheduleModule.forRoot()` 在 `AppModule` 中全局注册。
- 三个 cron service 目前**均未从所属模块导出**（`TodaySuggestionModule` 只导出
  `SuggestionService/FeedbackService/ExplanationService`；`MedicineRemindersModule`
  只导出 `MedicineRemindersService`；`DataRetentionModule` 无 exports）——
  `CronJobsModule` 要注入它们必须先补 exports（见 Phase 4a）。

---

## 设计决策

### D1: 进程分离模式——同镜像 + `WORKER_MODE` 环境变量

遵循 ADR-0004 的"同镜像、不同命令"思路，但用环境变量代替 CLI flag（Docker 原生支持）：

| `WORKER_MODE` | 进程角色             | 创建 Queue | 创建 Worker | 监听 HTTP | 注册 @Cron                 |
| ------------- | -------------------- | ---------- | ----------- | --------- | -------------------------- |
| 未设置        | 兼容模式（当前行为） | ✅         | ✅          | ✅        | ✅（迁移期间）→ Repeatable |
| `api`         | API 进程             | ✅         | ❌          | ✅        | ❌                         |
| `worker`      | Worker 进程          | ❌         | ✅          | ❌        | ❌（用 Repeatable 替代）   |

> **为什么 worker 进程不创建 Queue？** `BaseAsyncQueueService.pollStatus()` 需要
> `queue.getJob()`，但 `pollStatus()` 只在 API 进程被调用（通过 controller 端点），
> worker 进程中的 Queue 引用完全不会被用到。不创建 Queue 可减少 worker 进程的
> Redis 连接数。Queue 深度指标（active/waiting counts）由 API 进程的 queue-only
> 实例继续做 metrics poll 上报，不丢失。

> **为什么 API 进程不创建 Worker？** 核心目标就是让 CPU 密集的 PDF/LLM 任务
> 不在 API event loop 中执行。如果 API 进程仍创建 Worker，一个慢任务
> 会阻塞 HTTP 响应——分离就没有意义了。

> **已知指标缺口**：`recordBullmqJob`（completed/failed 计数）只在有 Worker 的
> 进程内累加。分离后这些计数产生在 worker 进程，而 worker 默认不暴露 `/metrics`，
> Prometheus 抓不到。由 D6 的探针端口解决。

### D2: `BullmqQueueFactory` 新增 `mode` 参数

`createQueue()` 的 `QueueCreateOptions` 新增可选 `mode` 字段：

```typescript
interface QueueCreateOptions<TData, TResult> {
  name: string;
  // ... 现有字段 ...
  /** 省略时从 WORKER_MODE 环境变量推断 */
  mode?: 'full' | 'queue-only' | 'worker-only';
}
```

- `full`（默认，向后兼容）：创建 Queue + Worker + metrics poll
- `queue-only`：创建 Queue + metrics poll，**不创建 Worker**，返回 `{ queue, worker: null }`
- `worker-only`：只创建 Worker，**不创建 Queue、不启动 metrics poll**，返回 `{ queue: null, worker }`

factory 在构造函数中读取 `WORKER_MODE`，未设置 / `''` 推断为 `full`，`api` →
`queue-only`，`worker` → `worker-only`。显式传 `mode` 可覆盖推断——
`lucent-cron` 队列依赖这一点（见 D3）。

### D3: `@Cron` → BullMQ Repeatable——逐个迁移

每个 `@Cron` 任务变为一个 BullMQ Repeatable Job。迁移后删除 `@Cron` 装饰器和
`ScheduleModule`。BullMQ Repeatable 基于 Redis 存储调度规则，天然分布式去重，
多 worker 实例下不会重复触发。

新增一个 `CronJobsModule`（`src/common/queue/cron-jobs.module.ts`）：

1. 定义 cron 队列名 (`lucent-cron`) 和 job 名
2. 在 `onModuleInit()` 中注册 repeatable job
3. 创建 Worker 处理 cron job（按 `job.name` 分发到对应 service 方法）

**注册 API 用 `queue.upsertJobScheduler()`，不用 `queue.add({ repeat })`**：

```typescript
await queue.upsertJobScheduler(
  'data-retention-cleanup', // 稳定的 scheduler id
  { pattern: DATA_RETENTION_CRON, tz: 'UTC' },
  { name: 'data-retention-cleanup', data: {} },
);
```

理由（bullmq ^5.78 已支持，当前依赖满足）：

- `queue.add({ repeat: { pattern } })` 以 repeat key 去重，**改 cron 表达式会生成一条
  新的 repeat 规则而旧规则残留**，导致同一任务按新旧两套规则重复触发，必须手工
  `removeRepeatable` 清理；
- `upsertJobScheduler` 以固定 scheduler id 幂等 upsert，改表达式原地更新，无残留。

**进程角色逻辑**（解决 worker-only 模式下 `queue: null` 无法注册 scheduler 的问题）：

- `WORKER_MODE=api`：`onModuleInit()` 直接 return——不建队列、不注册 scheduler、
  不建 Worker；
- `WORKER_MODE=worker` 或未设置：`createQueue({ name: 'lucent-cron', mode: 'full' })`
  **显式覆盖推断模式**，Queue + Worker 都创建，Queue 一定存在，注册 scheduler 后
  由本进程 Worker 消费。

> 注：scheduler 只在 worker（及兼容模式）进程注册。worker 进程未启动时 repeatable
> 规则不会被重建——但规则持久化在 Redis，worker 重启后 `onModuleInit` 会幂等
> upsert，不会丢调度。

**时区**：所有 scheduler 显式 `tz: 'UTC'`，与生产容器现状一致（见现状清单的时区注）。

**模块接线**：`CronJobsModule` 需 `imports: [DataRetentionModule,
MedicineRemindersModule, TodaySuggestionModule]`，且三个 cron service 必须先加入
各自模块的 `exports`（目前均未导出，见现状清单）。不需要 `@Global()`——
`CronJobsService` 自产自用，没有其他模块消费它。

### D4: 向后兼容——未设置 `WORKER_MODE` 时行为不变

本地开发和 CI 环境不设 `WORKER_MODE`，factory 推断为 `full` 模式，队列行为保持
现状。`@Cron` 迁移是按任务逐个进行的：某个任务迁移后，它在兼容模式下改由
BullMQ Repeatable 驱动（机制变化，调度频率与语义不变）；全部迁移完毕后才删除
`ScheduleModule`。

### D5: Docker Compose 新增 `worker` service

`deploy/compose.yml` 在 `app` 旁新增 `worker` service：

- 同镜像 (`${LUCENT_IMAGE}`)——**deploy 流程无需额外拉镜像步骤**
- 同 `env_file: .env`，额外 `WORKER_MODE: worker`
- 不暴露业务端口；日志卷独立挂载 `./logs/worker:/app/logs`
- `stop_grace_period: 60s` + `stop_signal: SIGTERM`（与 app 一致；
  factory 的 `OnModuleDestroy` 会 `worker.close()` 等待在途 job 收尾）
- 资源限额独立设置

### D6: Worker 可观测性探针（推荐，解决 healthcheck + 指标缺口）

worker 进程不跑 `setupApp`，因此没有 `/metrics` 和 `/health`，这带来两个问题：
compose healthcheck 无 HTTP 端点可用；BullMQ job completed/failed 计数（D1 的
指标缺口）Prometheus 抓不到。

**推荐方案**：worker 模式下启动一个极简探针——新增 `setupWorkerProbe(app)`，
只注册两条路由（不挂 `api` 全局前缀、不经 nginx、仅容器网络内可达）：

- `GET /healthz` → 200
- `GET /metrics` → Prometheus registry 输出（复用 MetricsModule 的 registry）

监听内部端口 `3001`，compose 加入 `observability` 网络供 Prometheus 抓取。
实现量约 30 行，随 Phase 2 一并落地。

**降级方案**（若不做探针）：healthcheck 用 `pgrep -f 'dist/main.js'`，并接受 job
计数指标缺口。**不要用 `kill -0 1`**——镜像里 PID 1 是 tini，node 崩溃后容器整体
退出，`kill -0 1` 永远成功，形同虚设。

---

## 实施阶段

### Phase 1: `BullmqQueueFactory` 支持模式分离

**目标**：factory 能按 `mode` 参数创建 Queue-only / Worker-only，不改变现有行为。

**改动文件**：

1. `src/common/queue/queue.factory.ts`
   - 新增 `private readonly mode` 字段（从 `process.env[EnvKey.WORKER_MODE]` 推断，
     未设置 / `''` → `full`，`api` → `queue-only`，`worker` → `worker-only`）
   - `createQueue()` 内部按 `options.mode ?? this.mode` 分支：
     - `full`：当前逻辑不变
     - `queue-only`：创建 Queue + metrics poll，**不创建 Worker**
     - `worker-only`：创建 Worker，**不创建 Queue、不启动 metrics poll**
   - 返回类型不变：`{ queue: Queue | null; worker: Worker | null }`
   - `OnModuleDestroy` 现有逻辑已兼容 null（确认遍历时跳过 null 项）

2. `src/common/queue/queue.factory.spec.ts`
   - 新增 `queue-only` 和 `worker-only` 模式的测试用例

3. `src/common/queue/base-async-queue.service.ts`
   - 无代码改动：`this.queue` 已是 `Queue | null`，`isConfigured` 和 `pollStatus`
     对 `queue: null` 均有 guard（已核实）
   - 补一条 worker-only 模式下 `isConfigured === false`、`pollStatus` 返回 `null`
     的测试用例，固化该行为

**验证**：`pnpm test -- queue.factory.spec` + `pnpm test -- base-async-queue.service.spec` + `pnpm build`

---

### Phase 2: Worker 进程引导（`main.ts` 分叉）+ 探针

**目标**：`WORKER_MODE=worker` 时启动 NestJS app 但不监听业务 HTTP；按 D6 暴露
内部探针端口。

**改动文件**：

1. `src/main.ts`

   ```typescript
   async function bootstrap() {
     const workerMode = process.env[EnvKey.WORKER_MODE] ?? '';

     const app = await NestFactory.create<NestFastifyApplication>(
       AppModule,
       new FastifyAdapter({
         trustProxy: process.env[EnvKey.TRUST_PROXY] === 'true',
       }),
       { bufferLogs: true, bodyParser: false },
     );
     app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

     if (workerMode === 'worker') {
       // Worker 进程：不跑 setupApp（CORS/Swagger/Admin 等均不需要），
       // 只注册 /healthz + /metrics 探针（D6），监听内部端口
       await setupWorkerProbe(app);
       app.enableShutdownHooks();
       await app.listen(WORKER_PROBE_PORT, '0.0.0.0'); // 3001，常量定义在 setup-worker-probe.ts
       return;
     }

     const configService = app.get(ConfigService);
     await setupApp(app, configService);
     await registerAdminPanel(app, configService);
     app.enableShutdownHooks();

     const host = configService.getOrThrow<string>(`${ConfigKey.App}.host`);
     const port = configService.getOrThrow<number>(`${ConfigKey.App}.port`);
     await app.listen(port, host);
   }
   ```

   > `listen()` 内部会触发模块 init（`onModuleInit`），Worker 在此刻开始消费，
   > 无需单独调 `app.init()`。

2. 新建 `src/setup-worker-probe.ts` — 注册 `GET /healthz`（直接
   `app.getHttpAdapter().get('/healthz', ...)` 返回 200）和 `GET /metrics`
   （复用 MetricsModule 的 Prometheus registry，参考 `setup-app.ts` 中 /metrics
   的实现，不带 Basic Auth——只在容器网络内可达）

3. `src/config/env-keys.enum.ts` — 新增 `WORKER_MODE` 枚举值

4. `src/config/environment.validation.ts` — `WORKER_MODE` 加到 schema：
   ```typescript
   [EnvKey.WORKER_MODE]: z.enum(['', 'api', 'worker']).optional(),
   ```

**验证**：`pnpm typecheck` + `pnpm build` + 本地 `WORKER_MODE=worker node dist/main.js`
确认进程启动、不监听 3000、3001 的 `/healthz` 与 `/metrics` 可用

---

### Phase 3: Docker Compose 新增 `worker` service

**目标**：生产环境部署 app + worker 双容器。

**改动文件**：

1. `deploy/compose.yml` — 在 `app` service 后新增：

   ```yaml
   worker:
     image: ${LUCENT_IMAGE}
     container_name: lucent-worker
     restart: unless-stopped
     env_file:
       - .env
     environment:
       DATABASE_URL: postgresql://lucent:${POSTGRES_PASSWORD}@postgres:5432/lucent?schema=public
       REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
       NODE_ENV: production
       WORKER_MODE: worker
     expose:
       - '3001'
     volumes:
       - ./logs/worker:/app/logs
     networks:
       - backend
       - observability # 供 Prometheus 抓取 3001/metrics
     stop_grace_period: 60s
     stop_signal: SIGTERM
     healthcheck:
       test:
         [
           'CMD-SHELL',
           'wget -q -O - http://127.0.0.1:3001/healthz >/dev/null 2>&1 || exit 1',
         ]
       interval: 30s
       timeout: 5s
       retries: 3
       start_period: 20s
     logging:
       driver: json-file
       options:
         max-size: '50m'
         max-file: '5'
     deploy:
       resources:
         limits:
           cpus: '2.0'
           memory: 1G
         reservations:
           cpus: '0.5'
           memory: 256M
   ```

   > 若 D6 探针未落地（降级方案），healthcheck 改为
   > `test: ['CMD-SHELL', "pgrep -f 'dist/main.js' >/dev/null || exit 1"]`，
   > 并去掉 `expose`/`observability` 网络。**不要用 `kill -0 1`**（PID 1 是 tini，
   > 见 D6）。

2. `deploy/deploy.ts` — 部署流程新增 worker 管理：
   - 步骤 [4/12] **无需改动**（worker 与 app 同镜像，拉取一次即可）
   - 步骤 [6/12] 停机改为 `compose stop worker app`（先停 worker 再停 app）——
     **worker 必须在 [7/12] `prisma migrate deploy` 之前停止**，否则在途 job 会在
     迁移过程中读写正在变更的表
   - 步骤 [9/12] `compose up -d app` 且健康门通过后，再 `compose up -d worker`
     （worker 消费的是新 schema，必须晚于迁移完成）
   - `--rollback` 路径（[N/5]）同步修改：回滚镜像时 worker 一并回滚
   - smoke test 增加检查 worker 容器在运行

3. `deploy/smoke.ts` — `requiredServices` 数组增加 `'worker'`

4. `deploy/prometheus/` — Prometheus scrape 配置增加 `lucent-worker:3001` target
   （若 D6 落地）

**验证**：staging 环境完整部署走一遍，确认 app + worker 双容器正常启动、worker
日志无 HTTP 3000 监听、队列任务正常消费、Prometheus 能抓到 worker 指标

---

### Phase 4: `@Cron` → BullMQ Repeatable 迁移（逐个）

按风险从低到高排序，每个子阶段独立可部署。

#### Phase 4a: `DataRetentionService`（每日 03:00 UTC，最低频最低风险）

**改动文件**：

1. 新建 `src/common/queue/cron-jobs.module.ts`（**不需要 `@Global()`**）

   ```typescript
   @Module({
     imports: [
       DataRetentionModule,
       MedicineRemindersModule,
       TodaySuggestionModule,
     ],
     providers: [CronJobsService],
   })
   export class CronJobsModule {}
   ```

2. 新建 `src/common/queue/cron-jobs.service.ts`
   - 构造函数注入 `BullmqQueueFactory`、`DataRetentionService`、`LifecycleService`、
     `ReminderSchedulerService`
   - `onModuleInit()`：`WORKER_MODE === 'api'` 时直接 return；否则
     `createQueue({ name: 'lucent-cron', mode: 'full', processor })`，
     用 `upsertJobScheduler` 注册 3 个 repeatable job（`tz: 'UTC'`，见 D3）
   - worker processor 按 `job.name` 分发到对应 service 方法

3. 三个业务模块补 exports（本阶段先做 DataRetention）：
   - `src/modules/data-retention/data-retention.module.ts` —
     `exports: [DataRetentionService]`

4. `src/modules/data-retention/services/data-retention.service.ts`
   - 删除 `@Cron(DATA_RETENTION_CRON)` 装饰器（`cleanupExpiredData()` 已是
     `public`，无需改可见性）
   - 保留 `DATA_RETENTION_CRON` 常量（cron-jobs service 引用）

5. `src/app.module.ts` — imports 数组添加 `CronJobsModule`

**验证**：staging 环境确认 03:00 UTC 时 `lucent-cron` 队列有 job 被 worker 消费，
数据清理正常执行。

#### Phase 4b: `LifecycleService`（每 5 分钟，中频）

**改动文件**：

1. `src/modules/today-suggestion/today-suggestion.module.ts` —
   `exports` 增加 `LifecycleService`

2. `src/modules/today-suggestion/services/lifecycle/service.ts`
   - 删除 `@Cron(LIFECYCLE_REFRESH_CRON)` 装饰器（`refreshLifecycleStates()`
     已是 `public`，无需改可见性）

3. `src/common/queue/cron-jobs.service.ts` — Phase 4a 中已注册此 job，此处确认
   processor 调用 `lifecycleService.refreshLifecycleStates()`

**验证**：staging 环境确认每 5 分钟 `lucent-cron` 队列有 job，suggestion 状态
转换正常。

#### Phase 4c: `ReminderSchedulerService`（每分钟，最高频）

**改动文件**：

1. `src/modules/medicine-reminders/medicine-reminders.module.ts` —
   `exports` 增加 `ReminderSchedulerService`

2. `src/modules/medicine-reminders/services/scheduler.service.ts`
   - 删除 `@Cron(REMINDER_SCHEDULER_CRON)` 装饰器
   - 删除 `isDispatching` 进程内重入保护——重叠执行由 DB 唯一 delivery 记录
     幂等兜底（注意：BullMQ 并不阻止相邻 repeat 实例重叠，见现状清单注）
   - `dispatchDueReminders()` 已是 `public`，无需改可见性
   - 删除 `import { Cron } from '@nestjs/schedule'`

3. `src/common/queue/cron-jobs.service.ts` — 确认 processor 调用
   `reminderSchedulerService.dispatchDueReminders()`

**验证**：staging 环境确认每分钟有 job，reminder 通知正常发送，无重复通知。

#### Phase 4d: 清理 `ScheduleModule`

**改动文件**：

1. `src/app.module.ts`
   - 删除 `import { ScheduleModule } from '@nestjs/schedule'`
   - 删除 `imports` 中的 `ScheduleModule.forRoot()`

2. `package.json` — 确认 `@nestjs/schedule` 无其他引用（已核实全仓库仅 3 个
   `@Cron`，无 `@Interval`/`@Timeout`），从 `dependencies` 移除

**验证**：`pnpm typecheck` + `pnpm build` + `pnpm test:ci` 确认无 ScheduleModule
引用残留。

---

### Phase 5: 文档与可观测性

**改动文件**：

1. `docs/01-reference/deployment.md` — 更新：
   - compose 服务列表增加 `worker`
   - 部署流程步骤更新（先停 worker+app → migrate → 起新 app → 起 worker）
   - .env 示例增加 `WORKER_MODE` 说明（只在 compose.yml 的 `environment` 块设置，
     不在 .env 中配置）

2. `docs/01-reference/adr/0004-deployment-model.md` — Update：
   - 标记 "BullMQ Worker Topology" 未来计划为已完成
   - 顺带修正过时表述："All 7 BullMQ queue workers" → 9 个

3. `src/common/queue/base-async-queue.service.ts` — 修正注释 "5 async queue
   services" → 6

4. `docs/02-logs/migration-log/YYYY-MM-DD.md` — 追加迁移日志

5. `deploy/prometheus/rules/lucent.yml` — 新增 worker 进程告警（如
   `WorkerProcessDown`：worker 容器 down 或 3001/metrics 抓取失败）

6. `deploy/grafana/dashboards/lucent-backend-overview.json` — 新增 worker
   容器面板（可选）

---

## 回滚策略

| 阶段       | 回滚方式                                                                               |
| ---------- | -------------------------------------------------------------------------------------- |
| Phase 1    | `WORKER_MODE` 不设置 → factory 推断 `full`，行为不变                                   |
| Phase 2    | `WORKER_MODE` 不设置 → main.ts 走正常路径                                              |
| Phase 3    | compose.yml 回退到无 worker service 版本                                               |
| Phase 4a–c | 恢复对应的 `@Cron` 装饰器，并从 cron-jobs service 删除对应 scheduler（或保留——见下注） |
| Phase 4d   | 恢复 `ScheduleModule.forRoot()` 和 `@nestjs/schedule` 依赖                             |

> Phase 4 的回滚是安全的：如果 @Cron 和 BullMQ Repeatable 同时注册同一个
> 调度，最多是同一周期内触发两次（@Cron 触发 + Repeatable job 触发），但所有
> 三个任务都有幂等保护（DB 去重 / updateMany WHERE / deleteMany），不会产生
> 副作用。

---

## 依赖关系

```text
Phase 1 (factory refactor)
  └─→ Phase 2 (main.ts bootstrap + 探针)
        └─→ Phase 3 (compose worker service)
              └─→ Phase 4a (DataRetention)
                    └─→ Phase 4b (Lifecycle)
                          └─→ Phase 4c (Reminder)
                                └─→ Phase 4d (remove ScheduleModule)
                                      └─→ Phase 5 (docs)
```

Phase 1–3 必须按序执行。Phase 4a–4c 可按任意顺序执行，但按风险从低到高排序。
Phase 4d 必须在 4a–4c 全部完成后。Phase 5 可与 Phase 3 后的任意阶段并行。

---

## 风险评估

| 风险                                                   | 可能性 | 影响 | 缓解                                                                                                          |
| ------------------------------------------------------ | ------ | ---- | ------------------------------------------------------------------------------------------------------------- |
| Worker 进程 crash 导致 cron 不执行                     | 中     | 中   | Docker `restart: unless-stopped` + Prometheus `WorkerProcessDown` 告警                                        |
| Repeatable 规则丢失（Redis flush）                     | 低     | 中   | `onModuleInit` 每次启动用 `upsertJobScheduler` 幂等重建                                                       |
| 修改 cron 表达式产生重复调度                           | 低     | 中   | `upsertJobScheduler` 固定 scheduler id，原地更新（若用 `queue.add({repeat})` 则旧规则残留，这是弃用它的原因） |
| 相邻 repeat 实例重叠执行                               | 低     | 低   | 三个任务均幂等（DB 唯一约束 / WHERE 子句 / deleteMany），重叠无副作用                                         |
| API 进程 enqueue 时 worker 未启动                      | 中     | 低   | `queue-only` 模式下 Queue 仍可 enqueue，job 在 Redis 排队等 worker 启动                                       |
| Worker 指标盲区（completed/failed 计数在 worker 进程） | 中     | 中   | D6 探针端口暴露 /metrics 供 Prometheus 抓取                                                                   |
| 长任务超过 `stop_grace_period` 被强杀                  | 低     | 低   | BullMQ stalled 机制自动重投；前提是所有 processor 幂等（现状已满足）                                          |
| 迁移期间 cron 重复触发                                 | 低     | 极低 | 所有 cron 任务幂等；BullMQ repeatable 去重                                                                    |
| `BaseAsyncQueueService` 在 worker 模式下 `queue: null` | 低     | 中   | `isConfigured`/`pollStatus` 已有 null guard（已核实）；Phase 1 补测试固化                                     |

---

## 完成标准

1. `WORKER_MODE=worker` 的容器能正常启动并消费所有 9 个队列的 job
2. `WORKER_MODE=api` 的容器不创建任何 Worker，纯 HTTP 服务
3. 未设置 `WORKER_MODE` 时行为与当前完全一致（本地开发 + CI）
4. 3 个 `@Cron` 任务全部迁移到 BullMQ Repeatable（`upsertJobScheduler`，`tz: 'UTC'`），`ScheduleModule` 与 `@nestjs/schedule` 依赖移除
5. 生产 deploy.ts 正确管理 app + worker 双容器的启动/停止/回滚，worker 先于 migrate 停止、晚于 app 健康门启动
6. worker 进程的 `/healthz` + `/metrics` 可被抓取（D6 落地时）
7. 所有测试通过：`pnpm test:ci` + `pnpm test:e2e:ci` + `pnpm lint:check` + `pnpm typecheck` + `pnpm build`
8. staging 环境完整部署验证通过

---

## 评审修订记录（2026-07-24）

本次评审对照源码核实后修订：

1. **修正 D1 自相矛盾**：原稿 D1 表格称 worker 模式创建 Queue ✅（以 pollStatus 为由），
   而 D2/Phase 1 的 `worker-only` 返回 `queue: null`。核实后 pollStatus 只在 API 进程
   调用，改为 worker 不创建 Queue。
2. **修复 D3 致命缺口**：原稿让 CronJobsService 用推断模式建队列——worker 模式下
   factory 推断 `worker-only` 返回 `queue: null`，repeatable 注册无从谈起。改为
   `WORKER_MODE=api` 时跳过、`worker`/兼容模式显式 `mode: 'full'`。
3. **注册 API 升级**：`queue.add({repeat})` → `queue.upsertJobScheduler()`（bullmq
   ^5.78 支持），避免修改 cron 表达式时旧规则残留导致重复调度。
4. **补模块接线**：三个 cron service 均未从所属模块导出，原稿的注入不可行；
   补 `imports` + `exports` 清单；去掉无意义的 `@Global()`。
5. **修正方法可见性**：`cleanupExpiredData()`、`dispatchDueReminders()`、
   `refreshLifecycleStates()` 均已 `public`，删除原稿"改为 public"的多余步骤。
6. **纠正 isDispatching 删除理由**：BullMQ 不阻止相邻 repeat 实例重叠，真正兜底的是
   DB 唯一约束的幂等性。
7. **修正 compose healthcheck**：原稿 YAML 里复制了 app 的 HTTP healthcheck 又在注释里
   说不可用，且 `kill -0 1` 无效（PID 1 是 tini）。改为 D6 探针 `/healthz`（推荐）或
   `pgrep -f 'dist/main.js'`（降级）。
8. **新增 D6 探针端口**：同时解决 healthcheck 与 BullMQ job 计数指标缺口（分离后
   completed/failed 计数产生在不暴露 /metrics 的 worker 进程）。
9. **修正 deploy.ts 步骤**：[4/12] 是 infra 镜像，同镜像无需改动；明确 worker 必须先于
   [7/12] prisma migrate 停止（避免迁移期间 job 写库）、晚于 app 健康门启动。
10. **队列名订正**：`meal-analysis` → `lucent-meal-analysis`；标注 ADR/源码注释中
    "7 workers"/"5 子类" 的过时表述，纳入 Phase 5 修正。
11. **时区显式化**：scheduler 统一 `tz: 'UTC'`，并说明对本地开发触发时刻的影响。
12. **背景措辞**：LLM 任务是 I/O 密集而非 CPU 密集，分离收益改为资源隔离与独立扩缩容。
