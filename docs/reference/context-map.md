---
status: active
owner: backend
quadrant: reference
updated: 2026-10-21
---

# 限界上下文与上下文映射

本文件是 Lucent 后端的**限界上下文清单与集成契约**。决策依据见
[ADR-0024](adr/0024-ddd-bounded-contexts-and-aggregates.md)；术语定义见
[glossary.md](glossary.md)。代码目录、聚合与事件以各模块
`README.md` 和 ADR 为准，本文件只维护上下文边界与上下游关系。

## 上下文清单

| 限界上下文          | 类型       | 现有模块                                   | 聚合根                                                    | 首批 |
| ------------------- | ---------- | ------------------------------------------ | --------------------------------------------------------- | ---- |
| Identity & Access   | supporting | `auth`                                     | `Account`、`Session`、`VerificationChallenge`             | 是   |
| Medicine Catalog    | core       | `medicines`（目录/导入/安全贴士）          | `Medicine`、`ImportBatch`、`SafetyTip`                    | 是   |
| Medication Safety   | supporting | `medicines`（风险检查）                    | `RiskAssessment`                                          | 是   |
| AI Assistant        | core       | `assistant`                                | `Conversation`、`Memory`、`Proposal`、`Summary`           | 是   |
| Daily Guidance      | core       | `today-suggestion`                         | `DailySuggestion`、`SuggestionFeedback`、`RuleDefinition` | 是   |
| Health Log          | core       | `daily-records`                            | `DailyRecord`                                             | 否   |
| Medication Tracking | core       | `medicine-dose-logs`、`medicine-reminders` | `DoseLog`、`Reminder`                                     | 否   |
| User Profile        | supporting | `user-health-context`、`user-settings`     | `HealthProfile`、`UserSettings`                           | 否   |
| Notifications       | supporting | `notifications`                            | `Notification`（投递记录）                                | 否   |
| Content/Ontology    | supporting | 检索语料、`deploy/semantica`               | `KnowledgeDocument`、`OntologyAssertion`                  | 否   |
| Admin BFF           | generic    | `admin`                                    | 无（命令/查询编排）                                       | 否   |

`medicines` 模块当前承载两个上下文：Medicine Catalog 与 Medication Safety。它们在模块内
分包，不共享聚合；拆分服务时按上下文边界走。

## 上下文映射

```text
Identity & Access ──UserId / AccountStatus──▶ 所有上下文
Medicine Catalog ──MedicineFact / IngredientId──▶ Medication Safety
Medicine Catalog ──MedicineFact──▶ Medication Tracking / Daily Guidance / AI Assistant
Health Log ──DailyRecordFact / MealFact──▶ Daily Guidance / AI Assistant
Medication Tracking ──DoseFact / ReminderFact──▶ Daily Guidance / AI Assistant
User Profile ──ProfileFact / Locale / Timezone / Unit──▶ Daily Guidance / AI Assistant
AI Assistant ──ProposedAction──▶ Health Log / User Settings（仅经用户确认）
Daily Guidance ──SuggestionEscalated──▶ Notifications
Content/Ontology ──ACL──▶ AI Assistant
Admin BFF ──命令/查询──▶ 各上下文
```

| 上游                | 下游                                                | 关系模式          | 发布语言                                     |
| ------------------- | --------------------------------------------------- | ----------------- | -------------------------------------------- |
| Identity & Access   | 所有上下文                                          | partnership       | `UserId`、`AccountStatus`                    |
| Medicine Catalog    | Medication Safety                                   | shared kernel     | `MedicineId`、`IngredientId`、`MedicineFact` |
| Medicine Catalog    | Medication Tracking / Daily Guidance / AI Assistant | customer-supplier | `MedicineFact`、`MedicineId`、`IngredientId` |
| Health Log          | Daily Guidance / AI Assistant                       | customer-supplier | `DailyRecordFact`、`MealFact`                |
| Medication Tracking | Daily Guidance / AI Assistant                       | customer-supplier | `DoseFact`、`ReminderFact`                   |
| User Profile        | Daily Guidance / AI Assistant                       | conformist        | `ProfileFact`、`Locale`、`Timezone`、`Unit`  |
| AI Assistant        | Health Log / User Settings                          | customer-supplier | `ProposedAction`                             |
| Daily Guidance      | Notifications                                       | customer-supplier | `SuggestionEscalated`                        |
| Content/Ontology    | AI Assistant                                        | ACL               | `OntologyQuery`、`OntologyFact`              |
| Admin BFF           | 各上下文                                            | customer-supplier | 管理命令/查询；BFF 不持有领域模型            |

## 集成规则

- **共享内核最小化**：只共享标识与值对象（`UserId`、`LocalDate`、`Timezone`、`Locale`、
  `Unit`）；不共享实体、聚合、Prisma model 或表。
- **读**：跨上下文读经 reader port 或领域事件；reader 返回发布语言事实，不返回对方聚合，
  不暴露 Prisma 查询 DSL。
- **写**：跨上下文写经目标上下文的命令/提案；AI Assistant 只能生成 `Proposal`，用户确认后
  由 Health Log / User Settings 执行。
- **事件**：领域事件只描述已发生的事实，经 outbox 发布；消费者按 `eventId` 幂等，
  事件 schema 带版本，删除/改义走新事件。
- **ACL**：外部系统与外部 DTO 只在下游 ACL 出现；领域层不 import SDK、生成客户端或
  外部字段类型。
- **禁止**：跨上下文 join、直查对方表、复用对方 repository、同步调用链串起多个上下文。

## 变更流程

新增或调整上下文边界时：

1. 先改本文件与 [glossary.md](glossary.md)，说明上下游与发布语言。
2. 新决策写新 ADR，不覆盖已有 ADR；ADR-0024 的聚合/分层规则仍然有效。
3. 同步模块 `README.md` 的边界、聚合与事件说明。
4. 更新 dependency-cruiser 规则；跨上下文内部路径必须被规则挡住。
