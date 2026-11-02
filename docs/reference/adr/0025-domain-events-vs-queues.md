# ADR-0025: 领域事件与任务投递的分界

- **Status**: accepted
- **Date**: 2026-10-24
- **Deciders**: LuoMuLoyal

## Context

ADR-0024 定下「事件是事实，不是命令；事件经 outbox 发布，消费者幂等，schema 版本化」。
`domain_events` 表与 `DomainEventOutboxService` 也随之落地（`FOR UPDATE SKIP LOCKED`
抢占、`attempts` 上限、`published_at` 结算，单测齐全）。

**但它是零生产者零消费者的。** 真正在跑的是 `EventEmitter2` 的进程内 `emitAsync`：
7 个事件名、23 处 `@OnEvent`，分属 `reports`、`today-analysis`、`today-suggestion`、
`medicines`。于是有三个具体缺陷：

- **丢事件的窗口**：生产点大多是「写库事务已提交 → 再 emit」。进程在这两步之间崩溃，
  事件永久丢失且没有补偿——日报写进去了，建议不重算，直到用户下次操作。
- **时长沿调用链累加**：`emitAsync` 同步等待所有监听器。一次日报写入要等 reports 的
  6 个缓存失效 + today-analysis 的重算入队 + today-suggestion 的 6 个缓存失效与重算入队。
  任何一个监听器慢，写入就慢。
- **`common/` 反向依赖业务模块**：`reminder-dispatch` 队列挂在
  `common/queue/cron-jobs.service.ts`，处理器直接调 `medicine-reminders` 的
  `dispatchDueReminders()`。这正是基线里 `common-no-module-imports` 告警的来源。

比「没接上」更糟的是**接错了方向**：事件该有的持久化在一张没人用的表里，而事件的扇出
通道在进程内。两类被混在一起的责任应该分开：

| 责任                 | 语义                                                         | 该用什么                     |
| -------------------- | ------------------------------------------------------------ | ---------------------------- |
| **领域事件（事实）** | 「发生了什么」。可能 0 个消费者，可能 5 个，要可回放、可重放 | outbox 持久化 + 多订阅者扇出 |
| **任务投递（命令）** | 「去做这件事」。恰好一个执行者，要重试、并发控制、监控面板   | BullMQ 队列                  |

## Decision

### 1. 串联，不是替代

```text
写事务提交后 append（与业务同进程，但不与业务同事务——见 Consequences）
        ↓ 轮询（5s）
outbox publisher
        ↓ 按订阅表扇出，每个订阅者一条独立任务
BullMQ 队列（独立重试、独立并发、BullMQ 面板可见积压）
        ↓
消费者
```

**关键变化：outbox 不再 `emitAsync` 到 `EventEmitter2` 就完事，而是把事件转成各消费者
队列里的任务。** 同一个事件对 `reports`（失效缓存）和 `today-suggestion`（重算）的
心智完全不同，后者要做防抖合并、要能在 BullMQ 面板上看到积压、失败要单独重试——
塞在进程内同步链路里，这些能力一个都拿不到。

### 2. 订阅表是纯数据

`src/common/events/subscriptions.ts` 声明 `eventName → [{queue, job}]`。

- **不含函数引用**，队列创建与业务逻辑仍在各自模块。
- `common/` **只能有队列名**，不能 import 业务模块（这正是缺陷三的教训）。
- **一个事件没有消费者就不写这一行**，不写空数组：空数组声称「我们确认过没人听」，
  而这句话三个月后无法复核。`risk-assessment.completed` 当前就处于这个状态。
- **一行只允许指向已经存在的消费者**。表按已迁移的消费者逐条填，不预先写满目标形态：
  先声明订阅、后建 worker，等于扇出一个没人领取的 job，事件静默无人处理。

### 3. 队列归属：队列跟着消费者走

| 队列                        | 归属                 | 变化                                     |
| --------------------------- | -------------------- | ---------------------------------------- |
| `lucent-event-fanout`       | `common`             | 新：outbox 轮询与扇出                    |
| `report-cache-invalidation` | `reports`            | 新：替代 `@OnEvent`                      |
| `medicine-risk-refresh`     | `medicines`          | 新：替代 health-context/reminder 监听    |
| `suggestion-recompute`      | `today-suggestion`   | 保持队列，消费方改为 `event-trigger` job |
| `lucent-reminder-dispatch`  | `medicine-reminders` | 搬：从 `common/queue` 移入模块           |

**一个队列可以承载多种 payload 形状，但必须按 `job.name` 分派。** `suggestion-recompute`
的处理器原本是 `processor: (job) => worker.process(job.data)`——完全不看 `job.name`。
扇出的 job 带着事件 payload（`date`），而 worker 读的是 `localDate`/`sourceVersion`；
直接复用队列会让 worker 拿到 `undefined` 并**静默重算错误的日期**，BullMQ 不校验
payload 形状，没有任何报错。所以扇出用独立 job 名 `event-trigger`，处理器按名字分派。

### 4. 幂等与失败

- **投递至少一次，`common/` 不提供去重。** job 带 outbox 行 id 作为 `eventId`；
  崩溃在「队列写入」与「outbox 结算」之间会重复投递。BullMQ job id 用
  `eventId:job:queue` 确定性生成，能吸收扇出重跑，但**覆盖不了「消费后崩溃重放」**。
  有副作用的消费者必须自行持久化已处理的 `eventId`。不设公共去重表/Redis key 是
  有意的：各消费者对「已处理」的定义与保留期不同。
- **扇出失败**：`attempts += 1`，5 次后 parked，靠运维面板可见。
- **队列未配置（无 `REDIS_URL`）**：退回进程内直接调用，与 `RecomputeQueueService`
  的 `isConfigured` 分支一致。本地开发与 e2e 没有 Redis，这条必须可用。
- **`dispatched_at` 与 `published_at` 分开**：前者是「扇出完成」，后者是「已结算」。
  `published_at IS NULL` 仍是轮询的认领条件，所以崩溃在两者之间只会重新结算、
  不会重复投递。

### 5. 共享词汇放共享内核

`RiskLevel`（`safe|caution|risk|danger`）定义在 `src/common/risk/risk-level.ts`：
它是**发布语言**（medicines 定级、通知分级、看板排序），不是某个上下文的私有知识。
`medicines/domain/services/risk-model.ts` 保留一份 `MedicineRiskLevel` 副本，因为
领域层不能 import `src/common/`（`ddd-domain-purity` 只允许同 domain 树内引用）；
两份由 `scripts/arch/risk-level-mirror.spec.ts` 锁定一致。

守卫放在 `scripts/` 而非 `src/common/`：`common-no-module-imports` 的
`from: ^src/common/` 覆盖该目录下所有文件（含 `*.spec.ts`），放在那里的守卫自己就会
把基线顶上去；而 `depcruise` 只扫 `src`。

## Options Considered

| Option                                         | Pros                                                                 | Cons                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **outbox 持久化 + 按订阅表扇出到队列（采纳）** | 不丢事件、写入不等消费者、每消费者独立重试与观测；`common/` 保持叶子 | 投递至少一次需消费者幂等；轮询有 5s 延迟；订阅表需与消费者同步维护 |
| 保留 `emitAsync`，只补 outbox 记录             | 改动最小；事件有了账                                                 | 扇出仍在进程内，时长累加与丢窗口都没解决；`common/` 依赖问题依旧   |
| outbox 轮询后仍 `emitAsync`（不引入队列）      | 复用现有 `@OnEvent`，迁移量小                                        | 拿不到独立重试/并发/积压可见；消费者仍与生产者同进程               |
| 直接上消息中间件（Kafka/RabbitMQ）             | 扇出与重放能力更完整                                                 | 引入新基础设施与运维面；当前吞吐与消费者数量不值得                 |
| 每模块各自直连 Redis 发布                      | 无共享层                                                             | 重复连接与重试逻辑；订阅关系散落各处，无法回答「谁在听这个事件」   |

## Consequences

### 达成的

- **事件持久化**：跨上下文事件先落 `domain_events` 再投递。进程在 append 之后崩溃，
  事件仍在表里，下一轮轮询继续投递；旧的 `emitAsync` 路径一旦进程崩溃就是永久丢失。
- **写请求不再等下游消费者**：写请求只做一次 append，不再同步等待全部监听器。
- **消费者独立重试与观测**：每个订阅者一条队列，失败独立重试、积压可见、并发可调。
- **`common/events/**` 零业务 import\*\*：扇出只认识队列名，不再反向依赖业务模块。
- **`reminder-dispatch` 回到其归属模块**：`common/queue` 的处理器不再调业务服务。

### 未达成的（如实记录，不要读成「已实现原子性」）

- **`append` 不在生产者的写事务内。** 6 个生产者的 `emitAsync` 调用点原本就在事务
  之外（如 `records.service.ts` 的 `.map()` 回调，事务已提交），append 只能在其后。
  **「业务提交成功 → 进程崩溃 → append 从未执行」这一段窗口仍然丢事件。**
  它比旧路径窄（旧路径只要在 emit 前崩溃就丢），**但它不是原子性**。
- **要达成原子性需要改 6 个模块的事务边界**（把 append 挪进 `$transaction` 回调），
  不在本次范围。
- **`cron-jobs.service.ts` 仍持有 4 个业务模块引用**（`daily-records`、
  `data-retention`、`today-suggestion`、`notification-preferences`），
  `common-no-module-imports` 的 3 条基线未归零。原计划认为搬走 `reminder-dispatch`
  即可归零；实际该规则**按文件记账**（同文件同规则去重为一条），搬走 5 个引用中的
  1 个只是从 5 减到 4，条数不变。这属于「cron 注册表知道所有定时任务的业务分支」，
  是另一类债，列为独立批次。
- **E0 的基线净收益 = 1 条**：`no-circular | today-suggestion/services/recompute/queue.service.ts`。
  且该条是本次迁移中引入又消掉的（类型抽出为 `recompute-job.types.ts`），
  不是清掉的既有债。

### 迁移中发现的既有缺陷

这三个都与 E0 改动无关，是迁移前就存在的：

1. **`reports/dashboard` 的缓存失效从未生效。** `cache.stores[0]` 是 `Keyv` 实例，
   而 `Keyv` 类没有 `keys()` 方法（`get/getMany/set/delete/deleteMany/clear/has/
disconnect/iterator`，无 `keys`），所以 `if (!store.keys) continue` 对每个 store
   都命中、`deleted` 恒为 0，且该路径**没有任何日志**——方法自己的注释却写着
   「failures are logged as warnings」。dashboard 缓存全靠 5 分钟 TTL 兜底。
   已改为 per-user 版本号（O(1)，无 key 扫描）。
2. **`medicines` 的旧防抖会饿死检查。** 旧实现是 `clearTimeout` + 重新 `setTimeout`，
   即每次事件都把 5 秒窗口从头开始；用户每 4 秒改一次用药则 `runStaticCheck`
   **永远不执行**。已改为不续期：保证「首次变更后 5 秒必查一次」。
3. **`common/queue` 的 `reminder-dispatch` 处理器直接调业务模块**（见 Context 第三个缺陷）。

> 迁移是最好的缺陷探测器：逐条对照旧行为是平时没人做的动作。这三个缺陷都不是重构
> 引入的，是重构逼出来的。

### 明确不做

- 不引入 event sourcing、独立事件存储或完整 CQRS 平台。
- 不引入 Kafka/RabbitMQ 等新中间件；BullMQ 已满足当前规模。
- 不做公共去重存储：各消费者的幂等语义不同，由消费者自己持久化 `eventId`。
- 不把 outbox 做成通用消息总线：它只负责「事实 → 各消费者队列」这一段。

### 两个队列的防抖语义相反，是有意的

- `suggestion-recompute`：等待中的 job **续期**（`changeDelay`）。重算贵（规则引擎 +
  LLM 文案），等用户录完再算一次更划算。
- `medicine-risk-refresh`：等待中的 job **不续期**。风险检查便宜（纯静态规则）且
  时效敏感，保证「首次变更后 5 秒必查」，否则高频变更的用户永远等不到检查。

两条策略源于「成本 × 时效」的不同权衡，不是不一致。两处注释互相引用。
