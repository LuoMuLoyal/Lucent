# 后端 DDD 剩余上下文迁移计划：事件与队列重做 / Medicines 收尾 / Identity & Access / Daily Guidance / AI Assistant

Created: 2026-10-24
状态: **规划中**——E0 待开工
范围: Lucent 剩余首批上下文 + 事件总线与队列体系；不拆分微服务
执行方式: **三个 worktree 并行**（见 §二），单轨道内串行、轨道间独立
关系: 细化 [`2026-10-21-ddd-refactor-backend.md`](2026-10-21-ddd-refactor-backend.md) §5–§6 的第 2–5 批；
本文只记录**当前状态 → 剩余动作**的差异

## 〇、约束变更记录

原计划（`2026-10-21-ddd-refactor-backend.md` §六）给迁移加了「批次内不改行为、公开 API 零 diff」
的约束。那个约束的目的是**让重构可 review**，不是产品要求。本计划取消它：

- **行为可以改**，包括公开 API、端点路径、operationId、DTO 形状、事件语义。
- **端点可以改**，改完照常 `pnpm export:openapi` → Flutter/Lumine 重生成契约。
- 唯一的硬约束：**改完必须比原来更对**，每个改动有测试兜住。

同时新增两条工程约束：

- **不产生无价值提交**。计划修订、临时文件、夹带改动不单独提交。每个提交对应一个
  能独立编译的切片，提交信息写清「改了什么、为什么」。
- **并行优先**。能并行的批次同时跑；不能并行的用文件归属和依赖顺序硬隔开（见 §二）。

## 一、盘点：事件与队列的真实形状

### 1.1 现在跑着的是进程内广播，不是 outbox

活跃的跨模块事件全部走 `EventEmitter2` **进程内** `emitAsync`：

| 生产者                | 事件                                       |
| --------------------- | ------------------------------------------ |
| `daily-records`       | `daily-record.changed`                     |
| `medicine-dose-logs`  | `dose-log.changed`                         |
| `medicine-reminders`  | `reminder.changed`                         |
| `health-events`       | `health-event.changed`                     |
| `user-health-context` | `health-context.changed`                   |
| `user-settings`       | `settings.changed`                         |
| `today-suggestion`    | `today-suggestion.materialization.changed` |

消费者（`@OnEvent`）共 23 处，分属 `reports`、`today-analysis`、`today-suggestion`、
`medicines`。其中 `today-suggestion/services/recompute/trigger.listener.ts` **一个文件挂了 6 个事件**。

`domain_events` 表 + `DomainEventOutboxService`（`FOR UPDATE SKIP LOCKED` 抢占、
`attempts` 上限 5、`publishedAt` 结算、单测齐全）**已实现但零生产者零消费者**。

### 1.2 三个真实缺陷

**(a) 丢事件的窗口**。生产点大多是「写库事务已提交 → 再 emit」。进程在这两步之间崩溃，
事件永久丢失，没有补偿：日报写进去了，建议不重算，直到用户下次操作。

**(b) 时长沿调用链累加**。`emitAsync` **同步等待所有监听器**。一次日报写入要等：
`reports` 的 6 个缓存失效 + `today-analysis` 的重算入队 + `today-suggestion` 的
6 个缓存失效与重算入队。任何一个监听器慢，写入就慢。

**(c) `common/` 反向依赖业务模块**。`reminder-dispatch` 队列挂在
`common/queue/cron-jobs.service.ts`，处理器直接调 `medicine-reminders` 的
`dispatchDueReminders()`。这正是基线里 `common-no-module-imports` 那 3 条告警的来源。

### 1.3 `domain_events` 应该负责什么

它现在什么都不负责，但比「没接上」更糟的是**接错了方向**：事件该有的持久化在一张没人用的
表里，而事件的扇出通道在进程内。两类被混在一起的责任应该分开：

| 责任                 | 语义                                                           | 该用什么                     |
| -------------------- | -------------------------------------------------------------- | ---------------------------- |
| **领域事件（事实）** | 「发生了什么」。可能 0 个消费者，可能 5 个，要可回放、可重放   | outbox 持久化 + 多订阅者扇出 |
| **任务投递（命令）** | 「去做这件事」。恰好一个执行者，要重试、并发控制、监控面板     | BullMQ 队列                  |

正确定位是**串联**，不是替代：

```text
写事务内 append（与业务同提交，不丢）
        ↓ 轮询
outbox publisher
        ↓ 按订阅表扇出，每个订阅者一条独立任务
BullMQ 队列（独立重试、独立并发、BullMQ 面板可见积压）
        ↓
消费者
```

**关键变化：outbox 不再 emit 到 `EventEmitter2` 就完事，而是把事件转成各消费者队列里的任务。**
同一个事件对 `reports`（失效缓存）和 `today-suggestion`（重算）的心智完全不同，后者要做
1 秒防抖合并、要能在 BullMQ 面板上看到积压、失败要单独重试——塞在进程内同步链路里，
这些能力一个都拿不到。

## 二、并行执行方案：三个 worktree

### 2.1 为什么可以并行

盘完依赖后发现，**E0 与三个上下文迁移之间几乎没有文件交集**：

| 交集类型                  | 文件                                                                                                     | 冲突程度        |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | --------------- |
| 生产者侧（改 emit）       | `daily-records`/`health-events`/`dose-logs`/`reminders`/`user-health-context`/`user-settings` 的 service | 低——各一行      |
| 消费者侧（删 `@OnEvent`） | `reports`、`today-suggestion`、`medicines`、`today-analysis` 的 listener                                 | 中——见 §2.4     |
| **共享注册表**            | `common/queue/queue-names.ts`、`queue-runtime.registry.ts`、`config/env/env-keys.enum.ts`、`app.module.ts`、`docs/reference/generated/openapi.json` | **高——必须预先归属** |

所以并行可行，前提是：**共享注册表整批预留，不拆给多个轨道改。**

### 2.2 三个轨道

```text
worktree-1  E0-event-bus    事件总线与队列重做（整条轨道串行）
worktree-2  D2-auth         Identity & Access 四层迁移
worktree-3  D1-medicines    medicines 收尾（先做）→ 完成后接 D3 Daily Guidance
```

三条一起起。worktree-3 做完 D1 后接着做 D3，不新开 worktree。

### 2.3 文件归属（硬边界）

| 轨道         | 独占写权                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **共享预留** | `common/queue/queue-names.ts`、`common/queue/queue-runtime.registry.ts`、`config/env/env-keys.enum.ts`、`app.module.ts`、`.env.*.example`、`docs/reference/generated/openapi.json`、`docs/logs/migration-log/**` |
| worktree-1   | `src/common/events/**`、`src/common/queue/**`（除共享两项）、`mail/`、生产者 service 的 emit 调用点、`reports/dashboard/cache-invalidation.listener.ts`、`today-analysis/services/recompute/trigger.listener.ts` |
| worktree-2   | `src/modules/auth/**`、`test/e2e/auth/**`；**为拆门面而改的 6 个消费方注入声明**（`account`/`assistant`/`data-export`/`files`/`user-settings`/`admin` 各一处 imports）     |
| worktree-3   | `src/modules/medicines/**`、`src/modules/today-suggestion/**`、`test/e2e/medicines/**`、`test/e2e/today-suggestion/**`                                                     |

**共享预留怎么落地**：在**主 worktree**（三轨开工前）先落一个极小的
`chore(arch): 预埋队列与事件注册表`提交，一次性把新队列名、并发键、环境变量、订阅表常量
加进去（只加不删、无人使用）。三个轨道此后**都不再动这些文件**；需要新增条目时提出来，
由主 worktree 统一加。

这一步很关键：不预埋的话，三条轨道会各改一遍 `queue-names.ts`，合并时必然手工解冲突。

### 2.4 已知的跨轨道耦合点

| 耦合                                                                                                         | 处理                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| worktree-1 删 `today-suggestion/.../trigger.listener.ts`，worktree-3（D3）也要动这个目录                     | **worktree-3 的 D1 阶段不碰 `today-suggestion`**；进入 D3 时 worktree-1 的对应提交应已合并     |
| worktree-1 删 `medicines/adapters/events/risk-assessment-requested.ts`，worktree-3 的 D1 要动 `medicines`    | 文件归属给 worktree-1，但 worktree-3 的 D1 **不碰这个文件**；D1 收尾时先合并 main 再确认        |
| worktree-2 的端点收敛改 `openapi.json`，worktree-1 也可能因 tag 变化重生成                                   | `openapi.json` 归共享预留：**只在轨道收尾时由该轨道重生成一次并立即合并**，不同时改             |
| worktree-1 的 E0 让事件异步，D2/D3 的 e2e 可能因时序假设失败                                                  | 各轨道的 e2e 若依赖同步事件，**在本轨道内改成等待轮询**，不要跨轨道等                            |

### 2.5 合并纪律

- 每个轨道在自己的 worktree 里跑完整门禁，**通过后再合**，不在 main 上修。
- 合并顺序：共享预留 → worktree-1（E0）→ 其余按完成先后。E0 先行是因为它动的是别人依赖
  的基础设施；如果某轨先完成，可以先合，但要排在 E0 之后重跑一次该轨道的门禁。
- 合并后 main 跑一次全量 `pnpm test` + `arch:check`，确认三条轨道没把基线往上顶。

## 三、每批次的固定门禁

```bash
pnpm typecheck
pnpm lint:check
pnpm arch:check          # 基线只允许递减
pnpm test                # 轨道内模块级；合并后 main 跑全量
pnpm export:openapi      # 有 API 改动则重生成，按 §2.3 归属执行
pnpm docs:verify
pnpm docs:links
```

本计划特有：**每个切片的提交单独可编译**——先加新文件、再切调用方、最后删旧文件。

## 四、E0（worktree-1）：事件总线与队列重做

### 4.1 `domain_events` 定型

补三样：

- `dedupe_key`（可空，唯一索引）：同一聚合同一变更的幂等键，让「更新两次」不变成两个任务。
- `dispatched_at`：扇出完成的时刻，与 `published_at`（所有订阅者都已投递）分开。
  现在只有一个 `publishedAt`，无法区分「扇出失败」和「某个消费者失败」。
- 保留 `attempts` / `last_error` 给轮询本身用。

### 4.2 声明式订阅表

```text
src/common/events/
  domain-events.ts                 事件名、payload 类型（扩充）
  domain-events-outbox.service.ts  append（事务内）/ 轮询扇出
  subscriptions.ts                 订阅表：eventName → 消费者队列 + job 名
```

```ts
export const EVENT_SUBSCRIPTIONS = {
  'daily-record.changed': [
    { queue: QUEUE_NAMES.reportCacheInvalidation, job: 'invalidate' },
    { queue: QUEUE_NAMES.suggestionRecompute, job: 'recompute' },
  ],
  'health-context.changed': [
    { queue: QUEUE_NAMES.reportCacheInvalidation, job: 'invalidate' },
    { queue: QUEUE_NAMES.suggestionRecompute, job: 'recompute' },
    { queue: QUEUE_NAMES.medicineRiskRefresh, job: 'refresh' },
  ],
} as const;
```

加一个消费者 = 订阅表加一行；不再需要目标模块 import 事件常量并写 `@OnEvent`。

**约束**：订阅表是 `common/` 里的**纯数据**，不含函数引用——队列创建仍在各自模块。
`common/` 只能有队列名，不能 import 业务模块（这正是缺陷 (c) 的教训）。

### 4.3 队列归属重排

| 队列                              | 归属模块             | 变化                                                         |
| --------------------------------- | -------------------- | ------------------------------------------------------------ |
| `lucent-event-fanout`             | `common`             | **新**：outbox 轮询与扇出                                    |
| `lucent-report-cache-invalidation`| `reports`            | **新**：替代 `@OnEvent`                                      |
| `medicine-risk-refresh`           | `medicines`          | **新**：替代 `HEALTH_CONTEXT_CHANGED`/`REMINDER_CHANGED` 监听 |
| `suggestion-recompute`            | `today-suggestion`   | 保持，消费方从 `@OnEvent` 改为队列 job                       |
| `lucent-reminder-dispatch`        | `medicine-reminders` | **搬**：从 `common/queue` 移到模块内                         |
| 其余 8 个队列                     | 各自模块             | 保持                                                         |

`reminderDispatch` 搬走后，`cron-jobs.service.ts` 只保留「到点触发」，不再出现业务分支，
基线里 3 条 `common-no-module-imports` 应归零。

### 4.4 失败与幂等

- 扇出失败（队列不可用）：`attempts += 1`，5 次后 parked，靠运维面板可见。
- 队列未配置（无 `REDIS_URL`）：**退回进程内直接调用**，与现有 `RecomputeQueueService` 的
  `isConfigured` 分支一致。本地开发与 e2e 不需要 Redis。
- 消费者幂等：job 带 `eventId`，消费侧按 `eventId` 去重。`suggestion-recompute` 已有
  `jobId = 队列名-userId-localDate` 的合并逻辑，保留。

### 4.5 行为变更

- **事件不再同步**。写入接口返回时下游可能尚未处理，最大延迟 = 轮询 5s + 防抖 1s。
  若前端依赖「写完立刻读新建议」，用 materialization 版本号做 pending 态提示，不退回同步。
- 写接口 **p95 应下降**（不再等待所有监听器），实测值记进迁移日志。

E0 本身不动 HTTP 路径。唯一需前置确认：`today-analysis` 与 `reports` 是否在读路径上同步
依赖事件结果——**开工第一步做这个 spike**。

### 4.6 提交切分

```text
1. feat(common): domain_events 增加 dedupe_key 与 dispatched_at
2. feat(common): 声明式事件订阅表与扇出服务
3. refactor(reports): 缓存失效改由队列任务驱动
4. refactor(today-suggestion): 重算触发改由队列任务驱动
5. refactor(medicines): 风险刷新改由队列任务驱动
6. refactor(medicine-reminders): reminder-dispatch 队列移出 common
7. refactor(common): EventEmitter2 退回模块内使用
```

第 3–5 步彼此独立；第 7 步最后（确认无跨模块 `@OnEvent` 残留）。

### 4.7 验收

- e2e：写一条日报 → `domain_events` 有且仅有一行 → 轮询后两个队列各一个 job。
- 杀进程重启：未投递事件在下一轮继续投递（模拟：直接插一行未发布记录）。
- `arch:check` 基线下降至少 3 条。
- 写接口 p95 前后对比记进迁移日志。

## 五、D1（worktree-3）：`medicines` 收尾

### 5.1 修两个层泄漏与两个缺陷

| # | 问题                                                                           | 处理                                                                  |
| - | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 1 | `application/use_cases/check-risk.ts` import `adapters/http/dto/risk-check.js`  | `RiskCheckCandidateDto` 下沉 `application/ports/`，adapter 反过来引用 |
| 2 | `infrastructure/persistence/{cn,drugbank}.ts` import `adapters/`                | 用到的类型下沉 `application/ports/`                                   |
| 3 | `medical_qa_chunks` 归属错位                                                    | **直接搬走**，见 5.3                                                  |
| 4 | 搜索/详情读模型混在一个 use case 里                                             | 拆 `application/read_models/`，见 5.2                                 |

修完 #1 #2 后基线 205 → 202，跑 `pnpm arch:baseline:update`。

### 5.2 补读模型边界

`application/use_cases/medicines.ts` 一个类同时承担搜索、详情、序列、识别、安全贴士。
按 ADR-0024 §4，拆成：

- `application/read_models/medicine-card.ts` — 搜索卡片形
- `application/read_models/medicine-detail.ts` — 判别联合详情 + 序列摘要
- `application/read_models/medicine-sequence.ts` — 序列正文

识别与安全贴士留在 use case（有副作用，不是读模型）。

### 5.3 `medical_qa_chunks` 搬到 assistant

唯一消费者是 assistant 检索，medicines 只是持有 admin 端点。直接搬：

1. `QaChunksAdminService` 与 `infrastructure/persistence/qa-chunks.ts` 移到 `assistant`。
2. `admin` 的 `/api/v1/admin/content/qa-chunks` 改调 assistant barrel。
3. **端点路径不变**（admin 面板链接稳定），只改 owner。
4. `medicines` README 删掉这张表。

### 5.4 `RiskAssessment` 聚合补位

- `domain/safety/{risk-assessment,risk-finding,risk-assessments}.ts`
- 落库与 `risk_assessment_completed` 事件在**同一事务**里 append（E0 提供能力）。
- 缓存清理改由 E0 的队列任务驱动，从 `check-risk.ts` 删掉内联调用。

> 本步依赖 E0 合并。若 worktree-3 先跑到这里，先停下等 E0，或把聚合部分先做、
> 事件接入留到 E0 合并后补一个提交。

### 5.5 提交切分

```text
1. refactor(medicines): 候选与来源类型下沉 application/ports
2. refactor(medicines): 搜索/详情/序列拆读模型
3. refactor(assistant): qa-chunks 归属搬入 assistant
4. feat(medicines): 风险检查补 RiskAssessment 聚合与领域事件
```

### 5.6 验收

- 基线 205 → 202（或更低）。
- `openapi.json` 只有 `qa-chunks` 的 tag/描述变化，路径零变化。
- 风险检查 e2e：一次检查产生恰好一条 `risk_assessment_completed`。

## 六、D2（worktree-2）：Identity & Access

### 6.1 目标结构（垂直切片）

| 切片                | 现有                                                                                                | 目标                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **S1 会话**         | `token.service.ts`(473)、`repositories/session.repository.ts`(252)、`session-admin.service.ts`(54)  | `domain/session/{session,refresh-token,sessions}.ts` + `infrastructure/persistence/sessions.ts`                |
| **S2 本地凭据**     | `identity/credential.service.ts`(209)、`identity/identity.service.ts`(257)、`account.service.ts`(80) | `domain/account/{account,email,password-hash,account-status,accounts}.ts` + `infrastructure/crypto/argon2.ts` |
| **S3 码类挑战**     | `identity/verification-code.service.ts`(376)、`identity/email-verification.service.ts`(145)         | `domain/challenge/{challenge,challenges}.ts`                                                                  |
| **S4 OAuth**        | `oauth/{facade,oauth,state}.service.ts`(749)、`providers/**`(1,321)                                 | `domain/account/oauth-identity.ts` + `infrastructure/oauth/*` + `adapters/acl/oauth-profile.ts`                |
| **横切：限流/人机** | `identity/{rate-limit,turnstile}.service.ts`(409)                                                   | `application/ports/rate_limit.ts` + `infrastructure/cache/rate_limit.ts`；Turnstile 进 `infrastructure/`       |

已有 `domain/session/cookie-policy.ts` + `application/use_cases/cookie-session.ts` +
`adapters/http/cookie.controller.ts` 保留，S1 把它的 `AuthService` 依赖换成端口。

### 6.2 门面拆掉

- 拆成 `application/use_cases/*`，每个能力一个 use case。
- 6 个消费方（`account`、`assistant`、`data-export`、`files`、`user-settings`、`admin`）
  改为注入具体 use case。
- barrel 只导出 use case 与守卫/装饰器，不再导出 `AuthService`。

跨模块改动，但改动面是**注入声明**，6 个模块各一两行。

### 6.3 必须保住的不变量

安全保证，不是风格。每条要有**脱离 Prisma mock 的纯单测**：

1. **反枚举**：账号不存在 / 无密码 / 密码错 / 验证码错 → 同一个 `AUTH_WRONG_PASSWORD`。
2. **依赖故障不得折进反枚举桶**：Argon2/DB/签 token/缓存异常 → `DEPENDENCY_UNAVAILABLE`
   或超时码原样上抛。把宕机报成密码错会引导用户重设一个没问题的密码。
3. **refresh 一次性轮换 + token family 重放检测**：宽限窗口内视为并发竞态只拒绝，窗口外
   视为盗用并撤销整族（RFC 9700 §4.13.2）。Lumine 的 `refreshSession()` 单飞直接依赖这条。
4. **停用即时失效**：`JwtAccessStrategy` 拒绝 `status !== 'active'`。
5. **人机验证在凭据比对之前**：不能让未证明来源的请求消耗 Argon2 与验证码配额；
   TURNSTILE 未配置即关闭，云侧不可达放行并 `warn`。

### 6.4 端点收敛

```text
现在：POST /auth/{register,login,refresh,logout}            → token 在响应体
      POST /auth/sessions/{register,login,refresh,logout}   → token 在 Set-Cookie

改为：POST /auth/register|login|refresh|logout              token 投递按 Accept 协商
      GET  /auth/sessions
      DELETE /auth/sessions/:sessionId
```

`/auth/sessions/*` 的问题不只是 `sessions`/`session` 差一个字母导致 operationId 歧义——
它描述的是**传输方式**而不是**资源**。8 条重复端点收敛成 4 条 + 2 条会话管理。

**风险**：`Set-Cookie` 依赖跨域配置正确（Lumine Web 与文档站同域，Tauri 走自定义协议）。
这条改动需实测 Lumine 三条路径，并同步 `apps/lumine/README.md` 的 auth 章节。

> 若实测发现 Tauri 下 `Set-Cookie` + `Accept` 协商有坑，退回「两条路径但重命名」：
> `/auth/cookie/{register,login,refresh,logout}`。

### 6.5 提交切分

```text
1. refactor(auth): 会话聚合与 repository 下沉四层
2. refactor(auth): 本地凭据聚合与 Argon2 端口化
3. refactor(auth): 验证码挑战聚合化
4. refactor(auth): OAuth 提供商落 infrastructure 与 ACL（5 个 provider 逐个）
5. refactor(auth): 限流与人机验证端口化
6. refactor(auth): 拆掉 AuthService 门面，6 个消费方改注入 use case
7. refactor(auth): 令牌出口按资源收敛（含契约再生成）
```

### 6.6 验收

- `test/e2e/auth` 现有 4 文件 / 1,753 行改写为新路径后通过。
- 5 条安全不变量各有纯单测。
- `openapi.json` 路径数下降。
- Flutter `bootstrap.dart` 与 Lumine `pnpm contract` 重生成后编译通过。

## 七、D3（worktree-3，接 D1）：Daily Guidance

### 7.1 目标结构

```text
domain/
  suggestion/     daily-suggestion.ts, suggestion-candidate.ts, suggestion-status.ts, suggestions.ts
  feedback/       feedback.ts, feedbacks.ts
  rule/           rule-definition.ts, rule-version.ts, rule-registry.ts
  policies/       scoring.ts, suppression.ts, arbitration.ts, lifecycle.ts
  signal/         signal.ts, signal-snapshot.ts        # 读模型，不是聚合
application/
  use_cases/      get-today-suggestion.ts, get-suggestion-history.ts, recompute-suggestion.ts, record-feedback.ts
  services/       pipeline.ts, presentation.ts
  read_models/    suggestion-card.ts, suggestion-history.ts
  ports/          signal-source.ts, copy-generator.ts, explanation-generator.ts, notification.ts
adapters/
  http/           today-suggestion.controller.ts, dto/
  queue/          recompute.ts, copy.ts, explanation.ts
  acl/collectors/ health-event.ts, medication.ts, medication-time.ts, profile.ts, record.ts, sleep-trend.ts
infrastructure/
  persistence/    suggestions.ts, feedbacks.ts, materialization.ts, baselines.ts
  cache/          suggestion.ts
  llm/            copy.ts, explanation.ts, prompts/, schemas/
  notifications/  escalation.ts
```

`adapters/events/` 不再需要——E0 之后事件消费走队列 job。

**8 条规则全部进 `domain/policies/`**。现有规则文件只有 `@Injectable()` + `randomUUID`
两处框架依赖，去掉即可变纯函数。规则是产品核心差异化，却是唯一必须靠 DI 容器才能测的
部分——42 个 spec 里占大头。

### 7.2 提交切分

```text
1. refactor(today-suggestion): 规则去 Injectable，落 domain/policies（8 条一次）
2. refactor(today-suggestion): 候选/仲裁/抑制/生命周期聚合成 domain
3. refactor(today-suggestion): collectors 落 adapters/acl
4. refactor(today-suggestion): 物化与反馈落四层 + repository
5. refactor(today-suggestion): 查询侧拆读模型
6. refactor(today-suggestion): 重算入口改由事件任务驱动（消费 E0 的队列）
```

### 7.3 顺带清掉的基线

`no-magic-numbers` 171 条占基线 83%，规则里的阈值常量天然是魔法数字。第 1 步把阈值
命名成常量，基线应在 D3 后显著下降。

## 八、D4：AI Assistant（E0 与 D3 之后，单开一轨）

最后一批，也是最容易失控的一批（82 文件 / 15,592 LOC）。不求一次到位，只求把边界画对。
开工时复用空闲出来的 worktree。

### 8.1 三步

**A. 聚合与持久化下沉（先做，收益最大）**

- `domain/conversation/{conversation,message,conversations}.ts` ← `repositories/conversation.repository.ts`
- `domain/memory/{memory,memories}.ts` ← `repositories/memory.repository.ts`
- `domain/summary/{summary,summaries}.ts` ← `repositories/summary.repository.ts`
- `domain/proposal/{proposal,proposed-action,proposals}.ts` ← `services/proposal-confirm.service.ts` + `tools/proposal/*`

`Proposal` 的四条规则（只有 pending 可确认、确认恰好一次、过期不可确认、动作目标必须属于
当前用户）现在藏在流程里，只能靠 e2e 覆盖，下沉后变成纯单测。

**B. LangGraph 落 adapter**

- `adapters/agent/langgraph.ts` 承接图装配；节点业务逻辑留 `application/services/`
- `application/` 不 import LangGraph，经 `application/ports/agent-runtime.ts` 抽象
- 顺手消掉 `agent/runtime/graph.ts` 的 `no-circular` 基线告警

**C. 工具层变 ACL**

- `tools/**` → `adapters/acl/tools/**`
- `semantica-client.service.ts` / `lightrag-client.service.ts` → `infrastructure/retrieval/` + ACL
- 纯策略（`tool-permissions.ts`、`read-helpers.ts`）上移 `domain/policies/`

A 必须先于 B（`write_review` 节点要调 `Proposal` 聚合）。A/C 可并行。

### 8.2 明确不做

- 不重写 AI 管线、不改提示词、不升级 LangGraph。
- 不把 `tools/` 拆成独立服务——那是微服务计划的事。

## 九、跨批次横切项

| 项                                   | 何时       | 说明                                                                                     |
| ------------------------------------ | ---------- | ---------------------------------------------------------------------------------------- |
| 共享注册表预埋                       | 三轨启动前 | 见 §2.3，一次性加完新队列名/并发键/环境变量/订阅表常量                                   |
| 新 ADR：事件与任务的分界             | E0 内      | `domain_events` 与 BullMQ 的职责划分是架构决策，写 ADR-0025                              |
| `arch:check` 基线收紧                | 每批次     | 修复后 `pnpm arch:baseline:update`；合并后 main 确认基线未回升                           |
| 模块 README 的「限界上下文」段       | 每批次     | 现有写法是「ADR-0024 **目标形态**（迁移时生效）」，完成后改为陈述句，删掉「目标形态」前缀 |
| `context-map.md` 的「首批」列        | D4 后      | 四个上下文全部完成后该列失去意义，删除                                                    |
| `2026-10-21-ddd-refactor-backend.md` | D4 后      | 计划执行完毕整体删除；战略设计已沉淀到 ADR-0024 与 `context-map.md`                       |

## 十、验收标准

- **提交质量**：每个提交对应一个能独立编译的切片，无夹带的临时改动、无纯修订提交。
- **不变量单测化**：D2 的 5 条安全不变量、D3 的 8 条规则、D4 的 `Proposal` 四条规则，
  各有一个不依赖 Prisma/DI 容器的纯单测。
- **事件链路可验证**：E0 后任何跨上下文事件都有「写入 → outbox → 队列 → 消费」的 e2e
  断言，且能在进程重启后继续投递。
- **契约同步**：D2 改了端点，Flutter 与 Lumine 的生成客户端必须同步重生成并编译通过。
- **并行无回归**：三条轨道合并后 main 的全量 `pnpm test` 与 `arch:check` 通过，基线未回升。
- **不做清单**：D3「不拆 policies 到独立模块」、D4「不重写 AI 管线」在对应模块 README
  写明理由，避免后续当成遗漏重提。
