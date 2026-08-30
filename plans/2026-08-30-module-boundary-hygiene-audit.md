# Lucent 模块边界卫生审计与修复

Created: 2026-08-30

## 一、背景

参照 `deepseek-harness` 的 package 组织模式（每个 package 有独立 `index.ts` barrel export、`peerDependencies` 声明依赖、`tests/` 同级、`README.md` + `invariant.ts`），对 Lucent 的模块边界纪律进行审计。

Lucent 是 NestJS monolith，不拆独立 package，但可以借鉴其 **barrel export 严格执行 + 跨模块深引用禁止** 的边界纪律。

同时基于对当前模块间耦合度的量化分析，引入 **"微服务式管理 + 单体部署"** 的部分实践：在单体内部模拟微服务的接口契约纪律（port 接口隔离、事件契约文档化），但保持单体部署和共享数据库。

## 二、审计数据快照

以下数据来自 2026-08-30 的全量 `rg` 扫描。

### 2.1 index.ts 覆盖率

| 检查项                       | 结果                  |
| ---------------------------- | --------------------- |
| `src/modules/*/index.ts`     | **24/24** 全部有 ✓    |
| `src/common/index.ts`        | 有，导出 118 个符号 ✓ |
| `src/common/result/index.ts` | 有 ✓                  |

### 2.2 跨模块深引用（绕过 `index.ts`）

共扫描出 **6 个源文件 + 1 个 spec 文件** 存在跨模块深引用违规：

#### 源文件违规

| 文件                                                                    | 深引用目标                                                           | 绕过了的 barrel                     | 缺失的导出符号                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| `common/queue/cron-jobs.service.ts`                                     | `data-retention/services/data-retention.service`                     | `data-retention/index.ts`           | `DataRetentionService`, `DATA_RETENTION_CRON`          |
| 同上                                                                    | `today-suggestion/services/lifecycle/manager.service`                | `today-suggestion/index.ts`         | `LifecycleService`, `LIFECYCLE_REFRESH_CRON`           |
| 同上                                                                    | `medicine-reminders/services/scheduler.service`                      | `medicine-reminders/index.ts`       | `ReminderSchedulerService`, `REMINDER_SCHEDULER_CRON`  |
| 同上                                                                    | `notification-preferences/services/weekly-insight-scheduler.service` | `notification-preferences/index.ts` | `WeeklyInsightSchedulerService`                        |
| `reports/services/clinic-summary/summary.service.ts`                    | `daily-records/repositories/daily-record.repository`                 | `daily-records/index.ts`            | `DailyRecordFact`（类型）                              |
| `notification-preferences/services/weekly-insight-scheduler.service.ts` | `reports/services/ai-summary/summary.service`                        | `reports/index.ts`                  | `ReportsAiSummaryService`                              |
| `assistant/services/core.service.ts`                                    | `daily-records/dto/create-record.dto` + `update-record.dto`          | `daily-records/index.ts`            | `CreateDailyRecordDto`, `UpdateDailyRecordDto`（类型） |

#### Spec 文件违规

| 文件                                             | 深引用目标                                                  | 数量 |
| ------------------------------------------------ | ----------------------------------------------------------- | ---- |
| `product-events/services/events.service.spec.ts` | `today-suggestion/services/rules/` 下 7 个具体 service 文件 | 7 处 |

### 2.3 `.module.ts` 深引用（不算违规）

多处 `import { XxxModule } from '../yyy/yyy.module'` 是 NestJS 惯例——模块引用必须指向 `.module.ts` 文件本身，不属于 barrel export 违规。

### 2.4 模块 `imports` 依赖图（编译期 DI 耦合）

从 24 个模块的 `imports: []` 数组提取出完整的依赖图。

**入度排名**（被多少模块 import）：

| 模块                  | 被依赖次数 | 角色                 |
| --------------------- | ---------- | -------------------- |
| `notifications`       | 5          | 基础设施（投递通道） |
| `daily-records`       | 4          | 核心业务（日报记录） |
| `auth`                | 4          | 基础设施（认证）     |
| `medicine-dose-logs`  | 4          | 核心业务（服药记录） |
| `user-settings`       | 3          | 基础设施（配置）     |
| `health-events`       | 3          | 核心业务（健康事件） |
| `product-events`      | 3          | 基础设施（事件总线） |
| `medicines`           | 2          | 核心业务（药品知识） |
| `medicine-reminders`  | 2          | 核心业务（提醒）     |
| `reports`             | 2          | 聚合层（报告）       |
| `assistant`           | 2          | 聚合层（AI）         |
| `user-health-context` | 1          | 核心业务（健康档案） |

**出度排名**（依赖多少模块）：

| 模块                       | 依赖次数 | 角色         |
| -------------------------- | -------- | ------------ |
| `today-suggestion`         | 8        | **顶层聚合** |
| `reports`                  | 7        | 顶层聚合     |
| `today-analysis`           | 6        | 顶层聚合     |
| `assistant`                | 6        | 顶层聚合     |
| `data-export`              | 3        | 横切工具     |
| `notification-preferences` | 2        |              |
| 其他                       | 0-1      | 叶子模块     |

**结论**：高耦合集中在 4 个"顶层聚合"模块（`today-suggestion`、`reports`、`today-analysis`、`assistant`），这是由业务性质决定的——它们的职责就是聚合多个数据源。

### 2.5 跨模块 DI 注入（运行期服务级耦合）

扫描出 ~15 处跨模块直接注入具体 service class：

| 消费方模块                                                         | 注入的跨模块 service                                                            | 来源模块                                | 模式                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------- | -------------------- |
| `today-suggestion` → `escalation.service`                          | `NotificationsService`, `PushDeliveryService`, `NotificationPreferencesService` | notifications, notification-preferences | **直接注入**         |
| `today-suggestion` → `record.service`                              | `UserSettingsService`                                                           | user-settings                           | **直接注入**         |
| `today-analysis` → `analysis.service`                              | `NotificationsService`                                                          | notifications                           | **直接注入**         |
| `reports` → `context.service`                                      | `UserSettingsService`                                                           | user-settings                           | **直接注入**         |
| `data-export` → `processor.service`                                | `ReportsService`, `NotificationsService`                                        | reports, notifications                  | **直接注入**         |
| `auth` → `notification.service`                                    | `NotificationsService`                                                          | notifications                           | **直接注入**         |
| `auth` → `facade.service`, `account.service`, `credential.service` | `UserService`                                                                   | user                                    | **直接注入**         |
| `auth` → `credential.service`                                      | `NotificationsService`                                                          | notifications                           | **直接注入**         |
| `assistant` → `core.service`                                       | `UserSettingsService`, `DailyRecordsService`                                    | user-settings, daily-records            | **直接注入**         |
| `assistant` → `read.service`                                       | `UserHealthContextService`, `UserSettingsService`                               | user-health-context, user-settings      | **直接注入**         |
| `assistant` → `query.service`                                      | `DailyRecordReader`（port 接口）                                                | daily-records                           | **通过 port 接口** ✓ |
| `assistant` → `read.service`                                       | `MedicineReminderReader`（port 接口）                                           | medicine-reminders                      | **通过 port 接口** ✓ |
| `medicine-reminders` → `scheduler.service`                         | `NotificationsService`                                                          | notifications                           | **直接注入**         |

**关键发现**：`assistant` 模块已经部分使用了 port 接口（`IDailyRecordReader`, `IMedicineReminderReader`）来解耦——这是"微服务式管理"的正确方向，但只在 assistant 一个模块做了。

### 2.6 事件耦合（运行期事件级耦合）

`@OnEvent` 监听器跨模块监听：

| 事件                     | 发布者              | 监听者模块                                            | 监听者数量 |
| ------------------------ | ------------------- | ----------------------------------------------------- | ---------- |
| `DAILY_RECORD_CHANGED`   | daily-records       | today-suggestion (2), today-analysis (1), reports (1) | 4          |
| `DOSE_LOG_CHANGED`       | medicine-dose-logs  | today-suggestion (2), today-analysis (1), reports (1) | 4          |
| `HEALTH_EVENT_CHANGED`   | health-events       | today-suggestion (1), today-analysis (1), reports (1) | 3          |
| `HEALTH_CONTEXT_CHANGED` | user-health-context | today-suggestion (2), medicines/risk (1), reports (1) | 4          |
| `SETTINGS_CHANGED`       | user-settings       | today-suggestion (2), reports (1)                     | 3          |
| `REMINDER_CHANGED`       | medicine-reminders  | today-suggestion (1), medicines/risk (1), reports (1) | 3          |

**事件耦合是健康的**——6 个事件类型、21 个监听器，全部是"数据变更 → 失效缓存/重算"模式。这不是过度耦合，而是必要的数据一致性传播。但事件没有文档化契约。

### 2.7 数据库层耦合

所有 40+ 个 Prisma model 共享同一个 schema，通过外键关联到 `User` 表。跨模块直接外键关系：

- `UserMedicineDoseLog` → `UserMedicineReminder`（dose-logs → reminders）
- `UserMedicineDoseLog` → `HealthEvent`（dose-logs → health-events）
- `UserDailyRecord` → `HealthEvent`（daily-records → health-events）

数据库层面是完全共享的——所有模块看到同一张 schema。**单体阶段不应隔离数据库**。

### 2.8 已有的 port 接口

部分模块已定义 `abstract class` port 接口：

| Port 接口                                                                                                      | 定义模块                   | 消费模块       |
| -------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------- |
| `UserHealthContextRepositoryPort`                                                                              | user-health-context        | —              |
| `MedicineReminderReaderPort` / `MedicineReminderRepositoryPort`                                                | medicine-reminders         | assistant      |
| `MedicineDoseLogReaderPort` / `MedicineDoseLogRepositoryPort`                                                  | medicine-dose-logs         | —              |
| `HealthEventRepositoryPort`                                                                                    | health-events              | —              |
| `AuthSessionRepositoryPort` / `AuthAccountRepositoryPort`                                                      | auth                       | —              |
| `DailyRecordReaderPort` / `DailyRecordRepositoryPort`                                                          | daily-records              | assistant      |
| `AssistantMemoryRepositoryPort` / `AssistantConversationRepositoryPort` / `AssistantSummaryRepositoryPort`     | assistant                  | —              |
| `IAssistantUserSettings` / `IMedicineReminderReader` / `IDailyRecordReader` / `IDailyRecordCandidateGenerator` | assistant (types/ports.ts) | assistant 内部 |

### 2.9 测试与源码同级归位

| 检查项                        | 结果                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `*.spec.ts` 与源码同目录      | ✅ 全部在 `src/modules/xxx/` 下与源码同级                    |
| e2e 测试组织                  | ✅ `test/e2e/` 按 feature 子目录，与 `src/modules/` 一一对应 |
| contract/security/performance | ✅ 独立在 `test/` 下，按测试类型分层                         |
| `test/helpers/`               | ✅ 共享测试工具在独立目录                                    |

### 2.10 模块 README / invariant 覆盖

| 检查项                       | 结果     |
| ---------------------------- | -------- |
| `src/modules/*/README.md`    | **0 个** |
| `src/modules/*/invariant.ts` | **0 个** |
| `src/common/README.md`       | **0 个** |

## 三、修复计划

### Phase 3: 推广 Port 接口隔离（"微服务式管理"核心）

将 `assistant` 模块已有的 port 接口模式推广到其他"顶层聚合"模块。目标：跨模块 DI 注入从"具体 service class"改为"port 接口"。

#### 3a. 定义跨模块 port 接口

需要为以下高频被注入的 service 定义 reader port 接口（只暴露读取方法，不暴露写入方法）：

- [ ] 3.1 `notifications` — 定义 `INotificationSender` port（暴露 `send()` / `sendBatch()` 等发送方法）
  - 当前直接注入方：`today-suggestion`, `today-analysis`, `auth`, `medicine-reminders`, `data-export`
- [ ] 3.2 `user-settings` — 定义 `IUserSettingsReader` port（暴露 `get()` / `getMany()` 等读取方法）
  - 当前直接注入方：`today-suggestion`, `reports`, `assistant`
- [ ] 3.3 `daily-records` — 已有 `DailyRecordReaderPort` ✓，确认 `assistant/core.service.ts` 是否通过 port 注入；如果不是，改为通过 port
- [ ] 3.4 `user-health-context` — 定义 `IUserHealthContextReader` port（暴露 `getSnapshot()` 等读取方法）
  - 当前直接注入方：`assistant/read.service.ts`
- [ ] 3.5 `reports` — 定义 `IReportReader` port（暴露 `getClinicSummary()` / `getAiSummary()` 等读取方法）
  - 当前直接注入方：`notification-preferences`, `data-export`
- [ ] 3.6 `user` — 已有 `AuthAccountRepositoryPort` ✓，确认 `auth` 模块是否通过 port 注入

#### 3b. 在 `index.ts` 中导出 port 接口

- [ ] 3.7 各模块的 `index.ts` 导出对应 port 接口（不导出具体 service 实现类）
- [ ] 3.8 各模块的 `*.module.ts` 中将 port 接口注册为 provider（`{ provide: INotificationSender, useExisting: NotificationsService }`）

#### 3c. 改造消费方注入

- [ ] 3.9 `today-suggestion/services/notification/escalation.service.ts` — `NotificationsService` → `INotificationSender`
- [ ] 3.10 `today-suggestion/services/collectors/record.service.ts` — `UserSettingsService` → `IUserSettingsReader`
- [ ] 3.11 `today-analysis/services/analysis.service.ts` — `NotificationsService` → `INotificationSender`
- [ ] 3.12 `reports/services/dashboard/context.service.ts` — `UserSettingsService` → `IUserSettingsReader`
- [ ] 3.13 `data-export/services/processor.service.ts` — `ReportsService` → `IReportReader`，`NotificationsService` → `INotificationSender`
- [ ] 3.14 `auth/services/notification.service.ts` — `NotificationsService` → `INotificationSender`
- [ ] 3.15 `auth/services/credential.service.ts` — `NotificationsService` → `INotificationSender`
- [ ] 3.16 `medicine-reminders/services/scheduler.service.ts` — `NotificationsService` → `INotificationSender`
- [ ] 3.17 `assistant/services/core.service.ts` — `UserSettingsService` → `IUserSettingsReader`，`DailyRecordsService` → `DailyRecordReaderPort`
- [ ] 3.18 `assistant/services/read/read.service.ts` — `UserHealthContextService` → `IUserHealthContextReader`，`UserSettingsService` → `IUserSettingsReader`
- [ ] 3.19 `pnpm lint:check` + `pnpm typecheck` + `pnpm test:ci` 验证

#### 3d. 保留直接注入的场景

以下场景**保留直接注入具体 service**，不改为 port 接口：

- `auth` → `UserService`：`UserService` 同时承担读写且 auth 是 account 管理的协作者，port 化收益低
- `data-export` → `ReportsService`：data-export 是横切工具不是核心聚合层，且只调用 report 生成方法
- 聚合层内部跨子 service 调用（如 `today-suggestion/services/` 内部的子 service 互调）：模块内部不需要 port 隔离

### Phase 4: 事件契约文档化

- [ ] 4.1 创建 `docs/01-reference/event-catalog.md`，记录 6 个事件的完整契约
- [ ] 4.2 每个事件记录：发布者模块、发布触发条件、payload 结构、监听者列表、监听者行为（缓存失效 / 重算 / 通知）
- [ ] 4.3 在 `docs/01-reference/` 目录注册该文档
- [ ] 4.4 `pnpm docs:check` 验证

### Phase 5: 模块 README（可选，P2 优先级）

- [ ] 5.1 为 `today-suggestion` 模块补 README — 最复杂模块，记录职责、子服务依赖图、规则引擎设计
- [ ] 5.2 为 `assistant` 模块补 README — AI 工具链，记录 agent runtime、tool 注册、LLM 适配、port 接口设计
- [ ] 5.3 为 `auth` 模块补 README — OAuth + JWT + 多策略，记录认证流程图

## 四、不建议做的

- **不拆独立 package**：NestJS DI 容器假设模块在同一编译单元，拆 package 会引入大量 `peerDependencies` 管理负担，收益极低
- **不隔离数据库表**：所有 40+ Prisma model 共享同一 schema。`today-suggestion` 需要聚合 7 个模块的数据，表级隔离会强制 N+1 查询或物化视图。单体阶段不应隔离 DB
- **不替换 EventEmitter 为消息队列**：当前 21 个事件监听器全部是"数据变更 → 失效缓存/重算"，同步同进程完成是正确的。Redis Pub/Sub 或 BullMQ 事件会引入序列化开销、网络延迟、消息丢失/重复消费复杂性。如果未来某个监听器需要跨进程（如 BullMQ worker），单独替换那个监听器即可
- **不对聚合层完全禁止直接 DI**：`reports` 需要聚合 7 个模块的数据。如果每个数据源都走 port 接口，需要定义 7 个 port 接口——过度抽象。聚合层直接 DI 是合理的
- **不引入 invariant.ts 模式**：NestJS 没有等价的运行时不变量检查框架，照搬需要先建工具链，投入远大于收益
- **不为标准 CRUD 模块补 README**：大部分 NestJS 模块是标准 CRUD，README 价值低

## 五、风险与注意事项

1. **Phase 1 是纯增量**：只在 `index.ts` 中添加 export，不删除现有导出，不改调用方，零破坏性。

2. **Phase 2 修改 import 路径**：需要确保 `index.ts` 已先导出对应符号（Phase 1 先做）。

3. **`product-events` spec 深引用**：7 处对 `today-suggestion/services/rules/` 的深引用可能是有意设计（rule service 的副作用测试），不要强行改走 barrel——先评估再决定。

4. **Phase 3 的 port 接口设计原则**：
   - 只为**高频被跨模块注入的 service** 定义 port（`NotificationsService` 5 处、`UserSettingsService` 3 处）
   - port 接口只暴露**消费方实际调用的方法子集**，不是完整 service API 的镜像
   - port 命名用 `I*Reader` / `I*Sender` 等行为语义，不用 `I*Service`
   - 通过 `{ provide: IXxx, useExisting: XxxService }` 注册，零运行时开销

5. **Phase 3 的渐进迁移策略**：不要求一次性改造全部 ~15 处直接注入。先定义 port 接口并注册 provider（3a-3b），然后按 feature 渐进迁移消费方（3c）。新代码强制走 port，旧代码在自然接触时迁移。

6. **Phase 4 的事件契约文档**：如果未来某个事件需要拆为跨进程消息（如 BullMQ 事件），该文档就是迁移契约的起点。

## 六、迁移路径：从单体到微服务

本计划不是"为微服务而微服务"。但如果未来业务规模增长到需要拆分，当前设计的演进路径：

```
当前状态                      中期演进                        远期（如需要）
─────────                    ──────                        ──────
单体 NestJS app              单体 + port 接口隔离           按聚合边界拆分服务
共享 Prisma DB               共享 DB + 模块级 repository    独立 DB 或共享只读副本
EventEmitter2 同步事件        同步事件 + 文档化契约           BullMQ 异步事件（按需替换）
直接注入 service class        port 接口注入                  port 实现：方法调用 → HTTP/gRPC
```

**关键原则**：每一步都是可选的——port 接口在单体中已有价值（可测试性、边界清晰），不需要"确定未来要拆微服务"才能做。
