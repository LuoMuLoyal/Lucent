# ADR-0009: 跨模块数据访问治理

- **Status**: accepted
- **Date**: 2026-07-17
- **Deciders**: LuoMuLoyal

## Context

2026-07-16 全库架构审查发现数据访问治理缺位：assistant 模块走 port + 服务注入的显式契约
（`assistant/types/ports.ts`），但其他模块直接注入 `PrismaService` 查询他模块的表，
两套集成模式并存。具体问题：

- `User` 表被 5 个以上的模块直接读写，软删除/字段语义变更需同步多处
- `userDailyRecord`、`userMedicineDoseLog` 各有 3 个外部模块直查，查询形态高度雷同
  （`userId + nonDeleted + 日期区间` findMany），select 子集与排序各自手写
- account 模块直接 `prisma.user.update` / `prisma.userIdentity.delete`，绕过 user 模块

审查同时确认：共享 helper 已存在（`common/helpers/prisma.utils.ts` 的 `nonDeleted`、
`prisma-ownership.utils.ts` 的 `ensureOwnedByUser`），软删除模型仅 4 个（`User`、
`UserMedicineReminder`、`UserMedicineDoseLog`、`UserDailyRecord`）。

## Decision

### 表归属（owning module）

| 表                                                                   | 归属模块            |
| -------------------------------------------------------------------- | ------------------- |
| `User`、`UserIdentity`、`UserSession`                                | user / auth 域      |
| `UserProfile`、`UserAllergy`、`UserCondition`、`UserCurrentMedicine` | user-health-context |
| `UserDailyRecord`（+Attachment）                                     | daily-records       |
| `UserMedicineDoseLog`                                                | medicine-dose-logs  |
| `UserMedicineReminder`、`UserReminderDelivery`                       | medicine-reminders  |
| `UserSetting`                                                        | user-settings       |
| `UserSuggestion*`                                                    | today-suggestion    |
| `Assistant*`                                                         | assistant           |
| `UserNotification`                                                   | notifications       |
| 药品知识库表（`CnMedicine*`、`Drugbank*`、`MedicineSafetyTip`）      | medicines           |

**User 表字段分组归属**：核心身份字段（email、nickname、avatar、passwordHash、status
等）归 user 模块；`securityPinEnabled` / `securityPinHash` / `securityPinChangedAt` /
`securityElevationVersion` 归 security-pin 模块，security-pin 对这四列的读写视为域内
访问（pin.service 现状保留）。

### 读规则

1. 跨模块**读**允许，但对软删除模型（`User`、`UserMedicineReminder`、
   `UserMedicineDoseLog`、`UserDailyRecord`）必须使用共享 `nonDeleted` helper，归属校
   验使用 `ensureOwnedByUser`。
2. 被 ≥2 个外部模块高频跨读的表，应收敛**提供方只读 reader port**（本次落地
   `DailyRecordReaderPort`、`MedicineDoseLogReaderPort`）；reader 返回显式 fact DTO，
   不暴露 Prisma 查询 DSL（WhereInput 等），规范排序固定在 reader 内。
3. Reader port 约定：abstract class 与实现同文件，`useExisting` 绑定到 owning module
   的 repository；`exports` 仅在存在外部消费者时（对齐 AGENTS.md "exported iff"）。

### 写规则

跨模块**写**必须经过 owning module 导出的 service，不得直接 `prisma.<他模块表>.create/
update/delete`。具名例外：

- `testing-support` 夹具（仅 `NODE_ENV=test` 注册 + 共享密钥守卫，跨表重置测试数据）
- AdminJS（整个 client 交给 `@sergiyiva/adminjs-prisma`，由资源配置受控）
- security-pin 写 User 表的 `securityPin*` 字段组（见字段分组归属）
- `common/llm/base-llm-summary.service.ts` 读 `userSetting`（现状保留，随
  `LlmCommonModule` 收敛时一并处理）

### 过渡说明

today-suggestion 的消费端 collectors 接入 reader 后，与 daily-records /
medicine-dose-logs 之间存在 `forwardRef` 双向模块引用——反向边来自这两个模块对
`TodaySuggestionModule` 的缓存失效调用。该 `forwardRef` 为临时手段，随架构审查计划
#2（缓存失效改事件驱动）落地后移除。

## Options Considered

| Option                                      | Pros                                               | Cons                                                                  |
| ------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| 提供方 reader port（本 ADR）                | 一份契约一份实现，多消费方复用；表语义变更只改一处 | owning module 需新增 exports；today-suggestion 引入临时 forwardRef    |
| 消费方 port（assistant 模式推广）           | 契约贴合各消费方需求（ISP）                        | 同一张表 3 个消费方 = 3 份接口定义，查询实现仍重复在提供方 service 里 |
| 全部收编到 owning service（禁一切直查）     | 边界最严                                           | 读模型模块（today-\*/reports）大量聚合查询被迫走窄接口，过度设计      |
| Prisma client extension 全局强制 nonDeleted | 从机制上消灭漏写                                   | 改变全局查询默认行为，影响面大；留作计划 #3 单独评估                  |

## Consequences

- **变简单**：daily records / dose logs 的 8 处跨模块直查收敛为 2 个 reader port，软删
  除过滤与排序只维护一份
- **变清晰**：写路径唯一入口（owning module service），User 表不再被随意 update
- **新增约束**：新增跨模块查询需自查本 ADR 读/写规则；review 时以表归属表为准
- **临时债**：today-suggestion ⇄ daily-records / medicine-dose-logs 的 `forwardRef`，
  计划 #2 落地后移除
- **不做**：reminder / currentMedicine / settings / allergy 的重复直查本次保留，由读
  规则约束，达到"高频"标准时再收敛
