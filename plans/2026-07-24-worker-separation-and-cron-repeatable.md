# BullMQ Worker 分离 + @Cron → Repeatable 迁移计划

## 背景

当前所有 BullMQ worker（9 个队列）和 3 个 `@Cron` 定时任务都在 API 进程内运行。
LLM 调用、PDF 生成等 CPU 密集任务与 HTTP 请求处理共享同一个 event loop，
在队列高峰时可能拖慢 API 响应。

ADR-0004 已规划"未来将 worker 拆到独立进程/容器"。本计划执行该规划，并将
`@Cron` 迁移到 BullMQ Repeatable Job，为未来多 worker 实例消除定时任务重复触发问题。

## 现状清单

### BullMQ 队列（9 个）

| 队列名                       | 并发     | Base 类                 | CPU 密集?             | 队列服务文件                                               |
| ---------------------------- | -------- | ----------------------- | --------------------- | ---------------------------------------------------------- |
| `lucent-mail`                | 3 (可配) | 直连                    | 否 (SMTP I/O)         | `mail/mail-queue.service.ts`                               |
| `meal-analysis`              | 1        | 直连                    | 是 (LLM vision)       | `daily-records/services/meal-analysis/queue.service.ts`    |
| `data-export`                | 1        | 直连                    | 中 (DB 查询 + 序列化) | `data-export/services/queue.service.ts`                    |
| `medicine-recognition`       | 1        | `BaseAsyncQueueService` | 是 (LLM vision)       | `medicines/services/medicine-recognition-queue.service.ts` |
| `today-analysis`             | 2        | `BaseAsyncQueueService` | 是 (LLM)              | `today-analysis/services/analysis-queue.service.ts`        |
| `suggestion-explanation`     | 2        | `BaseAsyncQueueService` | 是 (LLM)              | `today-suggestion/services/explanation/queue.service.ts`   |
| `suggestion-copy-generation` | 3        | `BaseAsyncQueueService` | 是 (LLM)              | `today-suggestion/services/copy/copy-queue.service.ts`     |
| `report-summary`             | 2        | `BaseAsyncQueueService` | 是 (LLM)              | `reports/services/ai-summary/summary-queue.service.ts`     |
| `clinic-summary-pdf`         | 1        | `BaseAsyncQueueService` | 是 (PDF)              | `reports/services/clinic-summary/pdf-queue.service.ts`     |

### @Cron 定时任务（3 个）

| 服务                       | Cron 表达式   | 调度           | 幂等?                              | 文件                                                |
| -------------------------- | ------------- | -------------- | ---------------------------------- | --------------------------------------------------- |
| `LifecycleService`         | `*/5 * * * *` | 每 5 分钟      | 是 (`updateMany` WHERE 子句防重复) | `today-suggestion/services/lifecycle/service.ts`    |
| `ReminderSchedulerService` | `* * * * *`   | 每分钟         | 是 (DB 唯一 delivery 记录去重)     | `medicine-reminders/services/scheduler.service.ts`  |
| `DataRetentionService`     | `0 3 * * *`   | 每日 03:00 UTC | 是 (deleteMany 幂等)               | `data-retention/services/data-retention.service.ts` |

> `ReminderSchedulerService` 额外有进程内 `isDispatching` 重入保护——迁移到
> BullMQ Repeatable 后可删除此 guard，因为 BullMQ 保证同一 job 同一时间只被一个
> worker 消费。

### 基础设施

- `BullmqQueueFactory`（`src/common/queue/queue.factory.ts`）：`createQueue()` 同时
  创建 Queue + Worker，两者绑定在同一个调用中
- `BaseAsyncQueueService`（`src/common/queue/base-async-queue.service.ts`）：5 个
  异步队列的基类，封装了结果缓存 + 状态轮询；构造函数调用 `factory.createQueue()`
  并保存 `this.queue` 引用用于 enqueue / pollStatus
- `ScheduleModule.forRoot()` 在 `AppModule` 中全局注册

---

## 设计决策

### D1: 进程分离模式——同镜像 + `WORKER_MODE` 环境变量

遵循 ADR-0004 的"同镜像、不同命令"思路，但用环境变量代替 CLI flag（Docker 原生支持）：

| `WORKER_MODE` | 进程角色             | 创建 Queue | 创建 Worker | 监听 HTTP | 注册 @Cron               |
| ------------- | -------------------- | ---------- | ----------- | --------- | ------------------------ |
| 未设置        | 兼容模式（当前行为） | ✅         | ✅          | ✅        | ✅                       |
| `api`         | API 进程             | ✅         | ❌          | ✅        | ❌                       |
| `worker`      | Worker 进程          | ✅         | ✅          | ❌        | ❌（用 Repeatable 替代） |

> **为什么 worker 进程仍创建 Queue？** `BaseAsyncQueueService.pollStatus()` 需要
> `queue.getJob()` 查询 job 状态。虽然 `pollStatus()` 只在 API 进程被调用（通过
> controller 端点），但 Queue 对象是构造时创建的，创建一个不用的 Queue 引用成本
> 可忽略（只是一个 Redis 连接）。保持创建 Queue 能让 `isConfigured` 判断和
> `BaseAsyncQueueService` 逻辑无需分叉。

> **为什么 API 进程不创建 Worker？** 核心目标就是让 CPU 密集的 LLM/PDF 任务
> 不在 API event loop 中执行。如果 API 进程仍创建 Worker，一个慢 LLM 调用
> 会阻塞 HTTP 响应——分离就没有意义了。

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

- `full`（默认，向后兼容）：创建 Queue + Worker
- `queue-only`：只创建 Queue（API 进程），返回 `{ queue, worker: null }`
- `worker-only`：只创建 Worker（worker 进程），返回 `{ queue: null, worker }`

factory 在构造函数中读取 `WORKER_MODE`，默认推断为 `full`。

### D3: `@Cron` → BullMQ Repeatable——逐个迁移

每个 `@Cron` 任务变为一个 BullMQ Repeatable Job，调度表达式不变。迁移后删除
`@Cron` 装饰器和 `ScheduleModule`。BullMQ Repeatable 的天然分布式去重保证多 worker
实例下不会重复触发。

新增一个 `CronJobsModule`（`src/common/queue/cron-jobs.module.ts`）负责：

1. 定义 cron 队列名 (`lucent-cron`) 和 job 名
2. 在 `onModuleInit()` 中注册 repeatable job（`queue.add(name, data, { repeat: { pattern } })`）
3. 创建 Worker 处理 cron job（调用对应 service 的方法）

> **谁注册 repeatable job？** `CronJobsModule` 只在 `WORKER_MODE=worker`（或未
> 设置的兼容模式）时注册 worker 和 repeatable pattern。API 进程
> (`WORKER_MODE=api`) 不注册 repeatable job，也不创建 worker。

### D4: 向后兼容——未设置 `WORKER_MODE` 时行为不变

本地开发和 CI 环境（`NODE_ENV=test`/`development`）不设 `WORKER_MODE`，
`factory` 推断为 `full` 模式，一切保持现状。`@Cron` 在兼容模式下仍由
`ScheduleModule` 驱动（直到 @Cron 全部迁移完毕后才删除 ScheduleModule）。

### D5: Docker Compose 新增 `worker` service

`deploy/compose.yml` 在 `app` 旁新增 `worker` service：

- 同镜像 (`${LUCENT_IMAGE}`)
- 同 `env_file: .env`
- 额外 `WORKER_MODE: worker`
- 不暴露端口
- `stop_grace_period: 60s`（与 app 一致，让 BullMQ worker 收尾）
- 资源限额独立设置

---

## 实施阶段

### Phase 1: `BullmqQueueFactory` 支持模式分离

**目标**：factory 能按 `mode` 参数创建 Queue-only / Worker-only，不改变现有行为。

**改动文件**：

1. `src/common/queue/queue.factory.ts`
   - 新增 `private readonly mode` 字段（从 `process.env.WORKER_MODE` 推断）
   - `createQueue()` 内部按 `mode` 分支：
     - `full`：当前逻辑不变
     - `queue-only`：创建 Queue + metrics poll，**不创建 Worker**
     - `worker-only`：创建 Worker，**不创建 Queue、不启动 metrics poll**（Queue 为 null）
   - 返回类型不变：`{ queue: Queue | null; worker: Worker | null }`

2. `src/common/queue/queue.factory.spec.ts`
   - 新增 `queue-only` 和 `worker-only` 模式的测试用例

3. `src/common/queue/base-async-queue.service.ts`
   - 无代码改动（`this.queue` 已是 `Queue | null`，逻辑兼容 `queue: null`）
   - 确认 `isConfigured` 和 `pollStatus` 在 `queue: null` 时正确处理

**验证**：`pnpm test -- queue.factory.spec` + `pnpm test -- base-async-queue.service.spec` + `pnpm build`

---

### Phase 2: Worker 进程引导（`main.ts` 分叉）

**目标**：`WORKER_MODE=worker` 时启动 NestJS app 但不监听 HTTP。

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

     if (workerMode !== 'worker') {
       const configService = app.get(ConfigService);
       await setupApp(app, configService);
       await registerAdminPanel(app, configService);
     }

     app.enableShutdownHooks();

     if (workerMode === 'worker') {
       // Worker 进程：不监听 HTTP，保持进程存活
       const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
       logger.log('Worker process started — HTTP server disabled', 'Bootstrap');
       // app 不会调用 listen()，NestJS 的 init() 已触发 onModuleInit
       await app.init();
     } else {
       const configService = app.get(ConfigService);
       const host = configService.getOrThrow<string>(`${ConfigKey.App}.host`);
       const port = configService.getOrThrow<number>(`${ConfigKey.App}.port`);
       await app.listen(port, host);
     }
   }
   ```

2. `src/config/env-keys.enum.ts` — 新增 `WORKER_MODE` 枚举值

3. `src/config/environment.validation.ts` — `WORKER_MODE` 加到 schema：
   ```typescript
   [EnvKey.WORKER_MODE]: z.enum(['', 'api', 'worker']).optional(),
   ```

**验证**：`pnpm typecheck` + `pnpm build` + 本地 `WORKER_MODE=worker node dist/main.js` 确认进程启动且不监听 3000 端口

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
     networks:
       - backend
     stop_grace_period: 60s
     stop_signal: SIGTERM
     healthcheck:
       test:
         [
           'CMD-SHELL',
           'wget -q -O - http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1 || exit 1',
         ]
       interval: 10s
       timeout: 5s
       retries: 12
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

   > **Worker healthcheck 问题**：worker 进程不监听 HTTP，`/api/v1/health`
   > 不可用。Phase 3 暂用 `app.init()` 后的进程存活检查（`kill -0`）替代：
   >
   > ```yaml
   > healthcheck:
   >   test: ['CMD-SHELL', 'kill -0 1 2>/dev/null || exit 1']
   >   interval: 30s
   >   timeout: 5s
   >   retries: 3
   >   start_period: 20s
   > ```
   >
   > 后续可在 worker 进程中注册一个极简 HTTP 探针（`/healthz` 返回 200），
   > 但那是独立优化项，不阻塞本计划。

2. `deploy/deploy.ts` — 部署流程新增 worker 管理：
   - 步骤 [4/12] 拉取镜像时增加 `worker`
   - 步骤 [6/12] 停 app 时同时停 worker（`compose stop app worker`）
   - 步骤 [9/12] 启动 app 后启动 worker（`compose up -d app worker`）
   - 回滚流程同步修改
   - smoke test 增加检查 worker 容器在运行

3. `deploy/smoke.ts` — `requiredServices` 数组增加 `'worker'`

**验证**：staging 环境完整部署走一遍，确认 app + worker 双容器正常启动、worker 日志
无 HTTP 监听错误、队列任务正常消费

---

### Phase 4: `@Cron` → BullMQ Repeatable 迁移（逐个）

按风险从低到高排序，每个子阶段独立可部署。

#### Phase 4a: `DataRetentionService`（每日 03:00 UTC，最低频最低风险）

**改动文件**：

1. 新建 `src/common/queue/cron-jobs.module.ts`

   ```typescript
   @Global()
   @Module({
     providers: [CronJobsService],
     exports: [CronJobsService],
   })
   export class CronJobsModule {}
   ```

2. 新建 `src/common/queue/cron-jobs.service.ts`
   - 构造函数注入 `BullmqQueueFactory`、`DataRetentionService`、`LifecycleService`、
     `ReminderSchedulerService`
   - `onModuleInit()`：注册 3 个 repeatable job（如果 `WORKER_MODE` 为 `worker`
     或未设置）
   - `createQueue()` 创建一个 `lucent-cron` 队列 + worker
   - worker processor 按 `job.name` 分发到对应 service 方法

3. `src/modules/data-retention/services/data-retention.service.ts`
   - 删除 `@Cron(DATA_RETENTION_CRON)` 装饰器
   - 将 `cleanupExpiredData()` 改为 `public` 方法（供 cron-jobs service 调用）
   - 保留 `DATA_RETENTION_CRON` 常量（cron-jobs service 引用）

4. `src/app.module.ts` — imports 数组添加 `CronJobsModule`

**验证**：staging 环境确认 03:00 UTC 时 `lucent-cron` 队列有 job 被 worker 消费，
数据清理正常执行。

#### Phase 4b: `LifecycleService`（每 5 分钟，中频）

**改动文件**：

1. `src/modules/today-suggestion/services/lifecycle/service.ts`
   - 删除 `@Cron(LIFECYCLE_REFRESH_CRON)` 装饰器
   - `refreshLifecycleStates()` 已是 `public` 方法，无需改可见性

2. `src/common/queue/cron-jobs.service.ts` — Phase 4a 中已注册此 job，此处确认
   processor 调用 `lifecycleService.refreshLifecycleStates()`

**验证**：staging 环境确认每 5 分钟 `lucent-cron` 队列有 job，suggestion 状态
转换正常。

#### Phase 4c: `ReminderSchedulerService`（每分钟，最高频）

**改动文件**：

1. `src/modules/medicine-reminders/services/scheduler.service.ts`
   - 删除 `@Cron(REMINDER_SCHEDULER_CRON)` 装饰器
   - 删除 `isDispatching` 进程内重入保护（BullMQ 保证同一 job 同一时间只被一个
     worker 消费，DB 唯一 delivery 记录也做了去重）
   - `dispatchDueReminders()` 改为 `public` 方法
   - 删除 `import { Cron } from '@nestjs/schedule'`

2. `src/common/queue/cron-jobs.service.ts` — 确认 processor 调用
   `reminderSchedulerService.dispatchDueReminders()`

**验证**：staging 环境确认每分钟有 job，reminder 通知正常发送，无重复通知。

#### Phase 4d: 清理 `ScheduleModule`

**改动文件**：

1. `src/app.module.ts`
   - 删除 `import { ScheduleModule } from '@nestjs/schedule'`
   - 删除 `imports` 中的 `ScheduleModule.forRoot()`

2. `package.json` — 确认 `@nestjs/schedule` 是否仍被其他地方使用，如果只有 @Cron
   依赖它则可从 `dependencies` 移除（先标为 optional，下个 release 确认无引用后
   删除）

**验证**：`pnpm typecheck` + `pnpm build` + `pnpm test:ci` 确认无 ScheduleModule
引用残留。

---

### Phase 5: 文档与可观测性

**改动文件**：

1. `docs/01-reference/deployment.md` — 更新：
   - compose 服务列表增加 `worker`
   - 部署流程步骤更新（停 app+worker → migrate → 起新 app+worker）
   - .env 示例增加 `WORKER_MODE`（只在 compose.yml 的 `environment` 块设置，
     不在 .env 中配置）

2. `docs/01-reference/adr/0004-deployment-model.md` — Update：标记"BullMQ Worker
   Topology"未来计划为已完成

3. `docs/02-logs/migration-log/YYYY-MM-DD.md` — 追加迁移日志

4. `deploy/prometheus/rules/lucent.yml` — 如果需要新增 worker 进程的告警规则
   （如 `WorkerProcessDown`），在此添加

5. `deploy/grafana/dashboards/lucent-backend-overview.json` — 如果需要新增 worker
   容器的面板，在此更新（可选）

---

## 回滚策略

| 阶段       | 回滚方式                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Phase 1    | `WORKER_MODE` 不设置 → factory 推断 `full`，行为不变                                           |
| Phase 2    | `WORKER_MODE` 不设置 → main.ts 走正常路径                                                      |
| Phase 3    | compose.yml 回退到无 worker service 版本                                                       |
| Phase 4a–c | 恢复对应的 `@Cron` 装饰器即可（cron-jobs module 的 repeatable job 会被 BullMQ 去重，不会冲突） |
| Phase 4d   | 恢复 `ScheduleModule.forRoot()`                                                                |

> Phase 4 的回滚是安全的：如果 @Cron 和 BullMQ Repeatable 同时注册同一个
> 调度，最多是同一分钟内触发两次（@Cron 触发 + Repeatable job 触发），但所有
> 三个任务都有幂等保护（DB 去重 / updateMany WHERE / deleteMany），不会产生
> 副作用。

---

## 依赖关系

```text
Phase 1 (factory refactor)
  └─→ Phase 2 (main.ts bootstrap)
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

| 风险                                                   | 可能性 | 影响 | 缓解                                                                    |
| ------------------------------------------------------ | ------ | ---- | ----------------------------------------------------------------------- |
| Worker 进程 crash 导致 cron 不执行                     | 中     | 中   | Docker `restart: unless-stopped` + Prometheus `BullMQJobFailures` 告警  |
| Repeatable job 注册丢失（Redis flush）                 | 低     | 中   | `onModuleInit` 每次启动重新注册；BullMQ 持久化 repeatable 规则          |
| API 进程 enqueue 时 worker 未启动                      | 中     | 低   | `queue-only` 模式下 Queue 仍可 enqueue，job 在 Redis 排队等 worker 启动 |
| Worker healthcheck 不可用                              | 中     | 低   | Phase 3 用 `kill -0` 替代；后续可加极简 HTTP 探针                       |
| 迁移期间 cron 重复触发                                 | 低     | 极低 | 所有 cron 任务幂等；BullMQ repeatable 去重                              |
| `BaseAsyncQueueService` 在 worker 模式下 `queue: null` | 低     | 中   | `isConfigured` 已处理 null；`pollStatus` 只在 API 进程调用              |

---

## 完成标准

1. `WORKER_MODE=worker` 的容器能正常启动并消费所有 9 个队列的 job
2. `WORKER_MODE=api` 的容器不创建任何 Worker，纯 HTTP 服务
3. 未设置 `WORKER_MODE` 时行为与当前完全一致（本地开发 + CI）
4. 3 个 `@Cron` 任务全部迁移到 BullMQ Repeatable，`ScheduleModule` 移除
5. 生产 deploy.ts 正确管理 app + worker 双容器的启动/停止/回滚
6. 所有测试通过：`pnpm test:ci` + `pnpm test:e2e:ci` + `pnpm lint:check` + `pnpm typecheck` + `pnpm build`
7. staging 环境完整部署验证通过
