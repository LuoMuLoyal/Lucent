# Lucent 架构升级分析

Last updated: 2026-07-10

本文档记录对 Lucent 后端架构的审查结果和升级建议，按优先级分类。跨项目升级项见文末。

---

## 1. 引入领域事件（Event-Driven Architecture）— 高优先级

### 现状

跨模块通信完全依赖直接服务注入。`today-suggestion` 模块的三个 Collector
（`MedicationCollectorService`、`RecordCollectorService`、`ProfileCollectorService`）
全部直接注入 `PrismaService` 并查询其他模块的表（`userMedicineReminder`、
`userMedicineDoseLog`、`userDailyRecord`、`userAllergy`、`userCondition`、`userProfile`）。
suggestion 引擎与 5+ 个模块的数据模型产生了直接耦合。

### 升级方向

引入 `@nestjs/event-emitter`，在关键写操作后发出领域事件：

- `DoseLogCreatedEvent`
- `DailyRecordCreatedEvent` / `DailyRecordUpdatedEvent`
- `ReminderUpdatedEvent`
- `HealthContextChangedEvent`

`today-suggestion` 模块订阅这些事件维护自己的读模型投影（read model projection），
而不是每次生成建议时跨表查询。这也为未来的实时建议推送（WebSocket/SSE push）奠定基础。

### 影响范围

`daily-records`、`medicine-dose-logs`、`medicine-reminders`、`user-health-context`、
`today-suggestion` 五个模块。

---

## 2. AI 端点 per-user 限流缺位 — 高优先级（Roadmap v1.0.0）

### 现状

- 全局 `ThrottlerGuard` 限流为 100 req/min
- Auth 模块有独立的 `AuthRateLimitService`（基于 Cache 的登录失败计数 + 锁定）
- AI 端点仅有零散的 per-controller `@Throttle` 装饰器（如 `explain` 端点 5/min、
  `feedback` 20/min），没有基于 Redis 的 per-user AI 配额管理

一个用户可以通过 `today-analysis/generate`、`reports/summary/generate`、
`assistant/stream` 等端点消耗大量 LLM token 而不受限制。

### 升级方向

- 实现一个共享的 `AiRateLimitService`（基于 Redis 滑动窗口）
- 通过 Guard 或拦截器统一应用在所有 AI 端点上
- 按用户 + 端点类型设置日配额和分钟配额
- 与已有的 `MetricsService.recordLlmCall` 集成，实现 token 级别的用量追踪和配额扣减

---

## 3. Repository Port 模式覆盖不一致 — 中优先级

### 现状

已有 6 个模块完成了 Repository Port 抽象：

- `daily-records`：`DailyRecordRepositoryPort`
- `assistant`：`AssistantConversationRepositoryPort` + `AssistantSummaryRepositoryPort`
- `auth`：`AuthSessionRepositoryPort` + `AuthAccountRepositoryPort`
- `user-health-context`：`UserHealthContextRepositoryPort`
- `medicine-dose-logs`：`MedicineDoseLogRepositoryPort`
- `medicine-reminders`：`MedicineReminderRepositoryPort`

但 `medicines`、`reports`、`today-suggestion`、`today-analysis`、`files`、
`notifications`、`data-export` 等模块仍然直接注入 `PrismaService`。

特别是 `today-suggestion` 模块的 12+ 个 service 全部直接依赖 `PrismaService`，
包括 `FeedbackService`、`LifecycleService`、`BaselineService`、
`SuggestionCacheService`、`EscalationService` 等核心业务服务。单元测试需要 mock
整个 `PrismaService` 接口，且业务逻辑与 Prisma 查询逻辑混在同一层。

### 升级方向

为 `today-suggestion` 和 `reports` 这类业务逻辑复杂的模块补充 Repository Port。
不需要一刀切——简单的 CRUD 模块（`files`、`environment`）可以保持直接注入。

---

## 4. AI 管道抽象碎片化 — 中优先级

### 现状

存在三套独立的 AI 集成模式：

| 模式              | 基类 / 运行时                                       | 用途                                                                                    |
| ----------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Structured Output | `BaseLlmGeneratorService` + `BaseLlmSummaryService` | Today Analysis、Report Summary（三层管道：Context → Generation → Policy & Persistence） |
| Agent Loop        | `AssistantRuntimeService` + LangGraph               | Assistant 对话（`prepare_context → agent ↔ tools → respond` 图循环）                    |
| Simple Completion | `ExplanationGeneratorService`                       | Suggestion AI 解释（复用 `LlmRuntimePort` 但未继承 `BaseLlmGeneratorService`）          |

三套模式各自实现了重试逻辑、安全策略检查、错误降级，但接口不统一。

### 升级方向

提炼一个更高层的 `LlmUseCase` 接口，覆盖三种执行模式（structured-output、
agent-loop、simple-completion），统一重试、安全策略、metrics、fallback 的横切关注点。
不必强行合并实现，但横切逻辑应共享。

---

## 5. 审计日志缺失 — 中优先级（Roadmap v1.0.0）

### 现状

安全敏感操作（密码修改、身份绑定、数据导出、Admin 面板写入）没有持久化的审计记录。
日志仅通过 Pino 输出到 stdout，没有结构化的 `audit_logs` 表。

### 升级方向

- 新增 `audit-logs` 模块，提供 `AuditLogService.record(userId, action, resourceType, resourceId, metadata)` API
- 通过拦截器或显式调用在安全敏感端点上记录
- 与领域事件系统（升级项 1）可共用基础设施

---

## 6. OpenTelemetry 分布式追踪 — 低优先级（暂时搁置）

### 现状

- 有 Prometheus metrics + Grafana dashboards
- 有 `X-Request-Id` 传播和 `RequestContextService`（AsyncLocalStorage）
- 没有分布式追踪，LLM 调用、BullMQ 任务、SSE 流的跨服务链路不可观测

### 升级方向

- 引入 `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations`
- 对 HTTP、PostgreSQL（Prisma）、Redis 自动埋点
- 手动为 LLM 调用和 BullMQ 任务添加 span

---

## 跨项目升级项

以下升级项涉及 Lucent 和 Luminous 双方，完整描述见
`../Luminous/docs/02-reference/architecture-upgrade-analysis.md`。

### A. API 合同同步自动化 — 高优先级

当前 OpenAPI 合同同步是手动步骤，Lucent API 变更可以在不被检测的情况下破坏 Luminous。
需要在 CI 层面建立自动检测机制。

### B. 推送通知基础设施 — 中优先级（两个 Roadmap 都已列入）

Lucent 有 `UserDevice` 模型和 `NotificationsModule`，但仅支持 in-app 通知。
需要集成 FCM/APNs + BullMQ 异步发送。Luminous 需要增加 remote push 权限请求和
token 注册流程。

### C. Feature Flag 系统 — 低优先级

`genUiEnabled` flag 已在 Luminous 提及，但没有系统化基础设施。Lucent 端存储 flag
配置（per-user / global），Luminous 端通过 Riverpod provider 注入。

---

## 优先级总结

| 优先级 | 升级项                      | 关联 Roadmap |
| ------ | --------------------------- | ------------ |
| 🔴 高  | 领域事件系统                | —            |
| 🔴 高  | AI 端点 per-user 限流       | v1.0.0       |
| 🟡 中  | Repository Port 覆盖一致性  | —            |
| 🟡 中  | AI 管道抽象统一             | —            |
| 🟡 中  | 审计日志                    | v1.0.0       |
| 🟢 低  | OpenTelemetry 分布式追踪    | 搁置         |
| 🔴 高  | [跨项目] API 合同同步自动化 | —            |
| 🟡 中  | [跨项目] 推送通知基础设施   | v1.1.0       |
| 🟢 低  | [跨项目] Feature Flag 系统  | —            |
