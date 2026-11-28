# BullMQ Worker 进程分离 + Go 编排器计划

> **状态：重开（2026-11-28 修订）。** 本计划自 2026-07-24 起草后从未实现，2026-08-16 裁决
> 「阶段错配、暂缓」。**2026-11-28 压测证伪了暂缓依据，现已重开，并升级为两阶段**：
> 阶段一 Node 进程分离（本文件 Phase 1–3），阶段二 Go 编排器（Phase 4）。
>
> **重开依据（实测，见 `ops/stress-test/results/2026-11-28/REPORT.md`）**：
> - 原暂缓理由「队列并发均为 1–3，单机量级下不是已观测痛点」**不成立**：
>   PDF 单次渲染 5.3 s，`concurrency: 1` 时第 2 个请求排 10 s、第 50 个排 4.3 分钟。
> - 原触发条件「p95 HTTP 延迟与队列高峰相关」**已满足**：PDF 并发下 `/health`
>   从 2.7 ms 劣化到 **10 s 超时**（000）。
> - 更关键：压测中进程进入 `STAT=Rl`、主线程 74% 空转、**撤除负载后不自愈**，
>   只能 `kill -9` 重启。根因即「重活与 HTTP 共享同一进程生命周期」。
>
> 目标：API 进程只处理 HTTP；重活由独立 worker 进程执行；调度层最终由 Go 编排器接管。

## 一、架构目标

```
                       ┌──────────────────┐
   HTTP 请求 ─────────▶ │  api (Node)      │  WORKER_MODE=api
                       │  只建 Queue       │  不建 Worker
                       │  不消费任务       │  可横向扩
                       └────────┬─────────┘
                                │ enqueue
                                ▼
                       ┌──────────────────┐
                       │ Redis (BullMQ)   │  命令/任务：恰好一个执行者
                       │                  │  Redis Sentinel 单机先上
                       └────────┬─────────┘
                                │ consume
                                ▼
                       ┌──────────────────┐
                       │ orchestrator(Go) │  调度：并发控制 / 限流 / 重试
                       │  goroutine 任务池 │  超时 / 熔断 / 跨语言分发
                       └────────┬─────────┘
                                │ dispatch（HTTP / gRPC）
                                ▼
                       ┌──────────────────┐
                       │ worker (Node)    │  WORKER_MODE=worker
                       │ PDF / LLM 执行    │  不监听业务 HTTP
                       │ 可多副本          │  mem_limit / cpuset 独立
                       └──────────────────┘
```

**分工原则（不许混）**

| 层 | 语言 | 职责 | 不做什么 |
|---|---|---|---|
| api | Node | HTTP、鉴权、校验、读写库、入队 | **不消费重活队列** |
| orchestrator | **Go** | 任务调度、并发闸门、限流、重试退避、超时、熔断、跨语言分发、死信重放 | **不做业务逻辑、不直接读写业务表** |
| worker | Node | 执行 PDF 渲染、LLM 调用等既有实现 | **不监听业务 HTTP** |
| RabbitMQ | — | 跨服务**事件**扇出（0..N，可回放） | **不派发命令/任务** |

> ⚠️ **为何 RabbitMQ 不承接 PDF 任务**：本仓库 `compose.yaml` 头部已写明分工——
> BullMQ 走 Redis 承担「命令/任务」（恰好一个执行者），RabbitMQ 承担「事实/事件」的
> 跨服务扇出。「生成某用户的 PDF」是一条命令，属 BullMQ。RabbitMQ 的接入条件见
> `docs/TODO.md`「RabbitMQ 跨服务事件通道」，**本计划不接它**。

> ⚠️ **为何 PDF 渲染不重写为 Go**：现有渲染核心是 `pdf-lib` + `@pdf-lib/fontkit` +
> CJK 可变字体（`report-pdf.ts:91-93`），并耦合 `kindLabel`/`statusLabel`/insight 等
> 业务语义与 i18n 文案。用 Go 重写等于把这份逻辑复制到第二门语言，从此双份维护、
> 必然漂移（与仓库「单一事实源」原则冲突）；且 Go 侧 CJK 可变字体子集化生态成熟度
> 明显低于 JS。**Go 只接管「谁来调度」，不接管「谁来渲染」。**

---

## 二、为什么先做 Node 进程分离（Phase 1–3），而不是直接上 Go

即便最终目标是 Go 编排器，**第一步仍应是 Node 侧的进程拆分**，理由是可验证性：

- 进程分离解决的是**架构耦合**（HTTP 与重活共享进程），与调度器用什么语言无关；
- 它能在 1 周内上线并立刻止血，且**不引入新语言运行时**，风险面最小；
- 有了 `WORKER_MODE=worker` 这个「纯执行器」边界之后，Go 编排器接管的才是**一个已经
  存在的稳定契约**（任务载荷 schema + 队列名），而不是同时改两件事。

> 用户裁决（2026-11-28）：**直接一步到位，做 Go 编排器 + Node worker**。
> 因此本计划把 Phase 1–3 与 Phase 4 合并为一条主线，但**保留 Phase 1–3 作为
> Phase 4 的前置**——Go 编排器需要一个「不消费队列、只监听 HTTP」的 api 进程和一个
> 「只执行、不监听 HTTP」的 worker 进程作为边界，否则它会接管到一个仍与 HTTP 共享
> 事件循环的目标上，失去意义。

---

## 三、Phase 1：`BullmqQueueFactory` 支持模式分离

**目标**：factory 能按模式创建 Queue-only / Worker-only，不改变现有行为。

### 改动文件

1. `apps/monolith/src/common/queue/queue.factory.ts`
   - 新增 `private readonly mode`（从 `WORKER_MODE` 推断）：
     - 未设置 / `''` → `full`（当前行为，向后兼容）
     - `api` → `queue-only`
     - `worker` → `worker-only`
   - `createQueue()` 按 `options.mode ?? this.mode` 分支：
     - `full`：Queue + Worker + metrics poll（现状）
     - `queue-only`：Queue + metrics poll，`worker: null`
     - `worker-only`：Worker，`queue: null`，不启动 metrics poll
   - 返回类型不变：`{ queue: Queue | null; worker: Worker | null }`
   - `OnModuleDestroy` 已兼容 null（确认遍历跳过）
   - **`lucent-cron` 特例**：worker-only 模式下仍以 `full` 创建，保证 scheduler 注册后
     由本进程 Worker 消费（原计划 D2 已记录此点）

2. `apps/monolith/src/common/queue/queue.factory.spec.ts`
   - 新增 `queue-only` / `worker-only` 用例

3. `apps/monolith/src/common/queue/base-async-queue.service.ts`
   - 无代码改动（`this.queue` 已是 `Queue | null`）
   - 补测试：worker-only 下 `isConfigured === false`、`pollStatus` 返回 `null`

**验证**：`pnpm --filter monolith test -- queue.factory.spec`、`base-async-queue.service.spec`、`pnpm build`、`pnpm typecheck`

---

## 四、Phase 2：Worker 进程引导 + 探针

**目标**：`WORKER_MODE=worker` 时启动 Nest 应用但**不监听业务 HTTP**，只暴露内部探针。

### 改动文件

1. `apps/monolith/src/main.ts` 分叉：

```ts
const mode = process.env[EnvKey.WORKER_MODE] ?? 'full';
// 所有模式都建 Nest app（模块装配一致，避免 worker 漏初始化依赖）
const app = await createApp();
if (mode === 'worker') {
  await setupWorkerProbe(app);      // 只注册 /healthz + /metrics
} else {
  await setupApp(app, configService);
  await registerAdminConsole(app, configService);
  await app.listen(port, host);
}
```

2. **新增 `setupWorkerProbe(app)`**（约 30 行）
   - `GET /healthz` → 200
   - `GET /metrics` → 复用 MetricsModule 的 registry（解决 job completed/failed 计数缺口）
   - 监听内部端口 `3001`（仅容器网络，不经公网）
   - ⚠️ 不要用 `kill -0 1` 做 healthcheck：镜像 PID 1 是 tini，node 崩了容器整体退出，
     `kill -0 1` 永远成功，形同虚设

3. `apps/monolith/src/config/env/env-keys.enum.ts` + `environment.validation.ts`
   - 新增 `WORKER_MODE`：`z.enum(['full','api','worker']).default('full')`

**验证**：worker 模式起进程后 `ss -ltn` 无 3000 监听、有 3001；`curl :3001/healthz` 200。

---

## 五、Phase 3：Compose 编排（Node 阶段）

### `compose.yaml` 新增两个 service

| service | 镜像 | `WORKER_MODE` | 端口 | 资源 |
|---|---|---|---|---|
| `app`（改） | `${LUCENT_IMAGE}` | `api` | 3000 | 现有 |
| `worker`（新） | 同镜像 | `worker` | 仅内部 3001 | `mem_limit` / `cpuset` 独立 |

关键点：

- **同镜像不同命令**，deploy 流程无需额外拉镜像步骤
- `worker` 不发布业务端口；`depends_on` 只需 postgres/redis healthy
- `DEPLOY`/`ROLLBACK`：两个 service 用同一个 `LUCENT_IMAGE` tag，切换镜像时一起换
- **DB 迁移只由 app 的 entrypoint 执行**（`MIGRATE_*`）；worker 设
  `MIGRATE_MAX_RETRIES=0` 或跳过迁移，避免两边并发跑 migrate

```yaml
worker:
  image: ${LUCENT_IMAGE:?LUCENT_IMAGE is required}
  restart: unless-stopped
  env_file: [.env]
  environment:
    WORKER_MODE: worker
    MIGRATE_SKIP: 'true'       # 迁移由 app 执行
  expose: ['3001']
  depends_on:
    postgres: { condition: service_healthy }
    redis: { condition: service_healthy }
  stop_grace_period: 60s
  stop_signal: SIGTERM          # factory 的 OnModuleDestroy 会 worker.close()
  deploy:
    resources:
      limits: { memory: 2g }
```

### 验收

| 场景 | 目标 |
|---|---|
| `docker compose up` 后 | `api` 无 Worker、`worker` 无 3000 监听 |
| 50 并发 PDF | api 进程 `/health` < 200 ms（不卡死） |
| `kill -9 worker` | **api 不受影响**，任务由新 worker 接管 |
| worker 内存超限 | 仅 worker 重启，api 正常 |

---

## 六、Phase 4：Go 编排器（核心新增）

### 6.1 为什么 Go 能接现有队列：不换 broker

**关键事实**：Go 侧已有与 BullMQ **wire 兼容**的实现，可读写同一套 Redis 键：

- [taskforcesh/bullmq-go](https://pkg.go.dev/github.com/taskforcesh/bullmq-go) ——
  **BullMQ 官方团队（taskforcesh）维护的 Go 端口**，队列布局与 TS 版一致。
- [mkq](https://pkg.go.dev/github.com/shiroha-a/mkq) —— 另一份 BullMQ v5+ 兼容实现，
  宣称 29 个集成测试对真实 TS 库验证过互通。

因此 Go 编排器**可以直接消费现有 `clinic-summary-pdf` 等队列**，无需重写队列层、
无需引入新 broker。这消掉了「上 Go 就要动整个队列栈」的风险。

> 选型建议：**优先用官方 `taskforcesh/bullmq-go`**（维护方与 TS 版同一团队，兼容性
> 契约最可靠）；`mkq` 作为备选。落地前必须用**真实 Redis + 真实 job** 做一次互通
> 验证（Phase 4.0 验收门），不可只信文档。

### 6.2 编排器职责边界

| 做 | 不做 |
|---|---|
| 从 BullMQ 取任务、按优先级/队列配额分发 | 不读写业务表（不 import Prisma、不连 PG 业务库） |
| goroutine 池并发控制（每队列配额、全局上限） | 不实现 PDF/LLM 业务逻辑 |
| 重试/退避/超时/熔断 | 不改 HTTP 契约 |
| 跨语言分发（Node worker、Python sidecar） | 不做鉴权（由 api 层负责） |
| 死信、重放、积压告警 | 不碰 RabbitMQ 事件通道 |
| 暴露 `/metrics`、`/healthz` | — |

**编排契约**：Go 编排器**不直接调渲染**，而是把任务分发到 Node worker 的执行端点
（内部 HTTP）。即：

```
orchestrator.Parse(job) → 组装 render request → POST http://worker:3100/render
                                              → 收 PDF 字节流 → 写对象存储 → 回写 job 结果
```

或（更彻底的解耦）让 orchestrator 只负责**调度决策**，实际执行仍由 Node worker
从队列直接消费，orchestrator 通过调整**队列配额与并发令牌**来控制节奏。两种形态
在 Phase 4.1 做一次取舍，**倾向后者**（少一跳、少一个失败面）。

### 6.3 仓库内落位

- 新增 `apps/orchestrator/`（Go module），加入 `go.work`
  （现有 `go.work` 已 use `./packages/contracts/go`，追加一项即可）
- 复用 `packages/contracts/go` 的生成类型（`openapi.gen.go`）做请求/响应结构，
  **禁止手写重复结构**（`go generate ./...` 已是现成流程）
- Turborepo 会自动把它识别为 package（`go.work` 的 use 即声明）

```
Lucent/
├── apps/
│   ├── monolith/          # Node: api + worker
│   └── orchestrator/      # Go: 调度编排（新增）
├── packages/contracts/go/ # 已有：OpenAPI 生成绑定（复用）
└── go.work                # 追加 use ./apps/orchestrator
```

### 6.4 分阶段落地

| 步骤 | 内容 | 验收 |
|---|---|---|
| **4.0 互通验证** | 用 `bullmq-go` 在真实 Redis 上读一个 Node 写入的 job、写回结果 | Node 侧 `queue.getJob()` 能读到 Go 写的结果 |
| **4.1 只读旁路** | orchestrator 只订阅 metrics、观察积压，**不参与调度** | 与现状行为一致，无副作用 |
| **4.2 接管单一队列** | 先接管 `clinic-summary-pdf`（CPU 最重、最容易验证） | 50 并发 PDF 下 api `/health` < 200 ms |
| **4.3 灰度其余队列** | 逐队列切换，保留 Node 原生 worker 作回退 | 每切一个队列跑一轮压测回归 |
| **4.4 下线 Node 侧的调度逻辑** | Node worker 退化为纯执行器 | — |

> **回退开关**：编排器接管与否由 env 控制（如 `ORCHESTRATOR_ENABLED` +
> 按队列名白名单 `ORCHESTRATOR_QUEUES=clinic-summary-pdf`），未列入的队列仍走
> Node 原生消费。**任何一步都可单独回退，不需要回滚镜像。**

### 6.5 可观测性

- orchestrator 暴露 `/metrics`（Prometheus）：队列积压、分发延迟、各 worker 成功率、
  熔断状态、goroutine 数
- 复用现有 VictoriaMetrics 抓取（`monitoring/victoriametrics/vmscraper.yml` 加一个 target）
- 日志沿用现有结构化字段约定（`docs/reference/logging-conventions.md`）

### 6.6 Go 编排器的并发模型（为何用 goroutine 是合理的）

- 每个在途任务一个 goroutine，`errgroup` + 信号量控制总并发
- 每队列独立配额（`chan struct{}` 令牌桶），防止单队列耗尽全局额度
- 熔断用 `gobreaker` 之类，按「下游 = Node worker / Python sidecar」维度隔离
- **注意**：goroutine 并发**不会让单次 PDF 变快**（那是 Node 侧 CPU 计算）。
  Go 的收益是**调度吞吐与隔离**：能在几千个在途任务下稳定控制节奏、快速失败、
  按队列分配资源。这一点必须在计划里写明，避免对收益产生错误预期。

---

## 七、Redis 高可用（与编排器并行推进）

用户裁决（2026-11-28）：**先单机 Sentinel，后续再扩多机。**

### 现状与根因

- `apps/monolith/src/config/services/cache.config.ts:28` 的 `createKeyv(redisUrl)`
  **未传任何超时参数** → Redis 不可达时命令无限等待，实测把 `/health` 拖到 **12 s 超时**。
- `common/health/cache.indicator.ts` 的探针**无超时保护**，且 `getReadyHealth()`
  把 cache 与 DB 探针并列无 timeout → cache 一卡，整个 `/health` + `/health/ready` 全废。
- `/health` 当前**等于** `/health/ready`（`app.service.ts:38-40`），而 Docker healthcheck
  打的正是 `/health` → 依赖挂就被判不健康。

### 修法（先做这步，与 Sentinel 解耦）

1. **客户端超时 + 快速失败**（根因修复）

```ts
createKeyv(redisUrl, {
  socket: { connectTimeout: 2_000, keepAlive: true },
  disableOfflineQueue: true,       // 断连立即 reject，不无限排队
})
```

2. **探针硬超时**：`CacheHealthIndicator.ping` 对 `set/get/del` 套
   `Promise.race([probe, timeout(1500)])`，超时即 down，**绝不让探针自身挂住**
3. **live/ready 分离**（[语义依据](https://soundscode.com/nestjs/nest-health)）：
   - `/health/live`：只测进程 → Redis 挂时**仍 200**（否则编排器误杀全部实例）
   - `/health/ready`：进程 + DB + cache → 快速 503
   - **Docker healthcheck 改指向 `/health/live`**

### Sentinel 落地（单机先行）

单机上 Sentinel **防不了整机故障**，只能防 Redis 进程挂。按用户决定先做，但须明确边界：

- 同机跑 1 master + 1 replica + Sentinel（`quorum` 不能靠同机多进程伪装成高可用）
- 客户端改为**哨兵模式连接**（非直连主库 IP），否则切换后客户端不知道新主
- 防脑裂：`min-replicas-to-write=1` + `min-replicas-max-lag=10`
- `REDIS_URL` 改为可表达 sentinel 配置（新增 `REDIS_SENTINELS` / `REDIS_MASTER_NAME`，
  `parseRedisUrl` 扩展；BullMQ 的 `createConnection` 同样要支持，且 worker 侧
  `maxRetriesPerRequest: null` 必须保留）
- BullMQ 官方明确 worker 连接**必须** `maxRetriesPerRequest: null`（[Persistent connections](https://docs.bullmq.io:8443/bull/patterns/persistent-connections)），
  接入 Sentinel 时不要顺手改掉

**扩多机后**：加一台机器即可把 replica + Sentinel 拆到独立故障域；真正的高可用在那时成立。

---

## 八、执行顺序与验收门

```
第 1 批（止血，1 周）
  ├─ Redis 客户端超时 + 探针隔离 + live/ready 分离
  ├─ Phase 1 factory 模式分离
  ├─ Phase 2 worker 引导 + 探针
  ├─ Phase 3 compose 增加 worker service
  └─ 顺手：PDF 改 subset: true（验证能否直接砍体积/耗时）

第 2 批（编排器接入）
  ├─ Phase 4.0 bullmq-go 互通验证（硬门：不通则回退 mkq 或暂缓）
  ├─ Phase 4.1 只读旁路
  ├─ Phase 4.2 接管 clinic-summary-pdf
  └─ Redis Sentinel（单机）

第 3 批（灰度其余）
  ├─ Phase 4.3 逐队列切换 + 每步压测回归
  ├─ Phase 4.4 Node 侧调度下线
  └─ SSE 上限 / 登录限流分层 / 安全组收口（见 11-28 修复计划其余项）
```

**统一回归门**：每批完成后复用 `ops/stress-test/` 脚本，对照
`ops/stress-test/results/2026-11-28/REPORT.md` 的「现状」列逐项验收。
**Phase 4.0 不通不进 4.1**；**api 的 `/health` 在 50 并发 PDF 下不达 < 200 ms 不进第 3 批**。

---

## 九、风险与明确不做的事

| 风险 | 处置 |
|---|---|
| `bullmq-go` 与 TS 版行为差异 | 4.0 用真实 Redis + 真实 job 验证；不通则换 `mkq` 或退回 Node 调度 |
| 双份调度逻辑漂移 | 4.x 期间**同一队列只允许一个调度者**（白名单控制），不做双活 |
| worker 与 app 并发跑迁移 | worker 跳过迁移（`MIGRATE_SKIP`），迁移只由 app 执行 |
| Go 编排器被误当成「性能银弹」 | 计划明确：goroutine 提升**调度吞吐**，不加速单次 PDF |

**不做**：

- ❌ 用 RabbitMQ 派发 PDF 命令（违反既有分工，见 §一）
- ❌ 用 Go 重写 PDF 渲染（双份业务逻辑 + CJK 字体生态风险，见 §一）
- ❌ Redis Cluster（当前数据 15 MB，无分片需求；[Sentinel 足够](https://cn.hostease.com/blog/comparisons/redis-sentinel-cluster-deployment/)）
- ❌ 编排器双活（切换期单调度者，避免重复执行）
