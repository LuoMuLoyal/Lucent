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

## 四、不建议做的

- **不拆独立 package**：NestJS DI 容器假设模块在同一编译单元，拆 package 会引入大量 `peerDependencies` 管理负担，收益极低
- **不隔离数据库表**：所有 40+ Prisma model 共享同一 schema。`today-suggestion` 需要聚合 7 个模块的数据，表级隔离会强制 N+1 查询或物化视图。单体阶段不应隔离 DB
- **不替换 EventEmitter 为消息队列**：当前 21 个事件监听器全部是"数据变更 → 失效缓存/重算"，同步同进程完成是正确的。Redis Pub/Sub 或 BullMQ 事件会引入序列化开销、网络延迟、消息丢失/重复消费复杂性。如果未来某个监听器需要跨进程（如 BullMQ worker），单独替换那个监听器即可
- **不对聚合层完全禁止直接 DI**：`reports` 需要聚合 7 个模块的数据。如果每个数据源都走 port 接口，需要定义 7 个 port 接口——过度抽象。聚合层直接 DI 是合理的
- **不引入 invariant.ts 模式**：NestJS 没有等价的运行时不变量检查框架，照搬需要先建工具链，投入远大于收益
- **不为标准 CRUD 模块补 README**：大部分 NestJS 模块是标准 CRUD，README 价值低

## 五、风险与注意事项

1. **`product-events` spec 深引用**：7 处对 `today-suggestion/services/rules/` 的深引用可能是有意设计（rule service 的副作用测试），不要强行改走 barrel——先评估再决定。

1. **Port 接口设计原则**：
   - 只为**高频被跨模块注入的 service** 定义 port（`NotificationsService` 5 处、`UserSettingsService` 3 处）
   - port 接口只暴露**消费方实际调用的方法子集**，不是完整 service API 的镜像
   - port 命名用 `I*Reader` / `I*Sender` 等行为语义，不用 `I*Service`
   - 通过 `{ provide: IXxx, useExisting: XxxService }` 注册，零运行时开销

1. **渐进迁移策略**：新代码强制走 port，旧代码在自然接触时迁移。

1. **Phase 4 的事件契约文档**：如果未来某个事件需要拆为跨进程消息（如 BullMQ 事件），该文档就是迁移契约的起点。

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
