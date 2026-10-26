---
status: active
owner: backend
---

# reports

报告聚合与 AI 摘要模块：仪表盘（dashboard）、AI 周期摘要（report summary）、
门诊摘要（clinic-summary：预览/分享/PDF 导出）、事件回顾（event review）。
所有成功响应是直接资源，不含 `{ code, message, data }` 信封。

## Endpoints（挂 `/user` 前缀，事实源 = openapi.json）

- `GET dashboard` — 报告仪表盘（含 medication adherence `observedMetric`：
  taken 为分子，skipped/overdueUnconfirmed 独立计数，无计划槽位返回
  `unknown` 而非 0%；水质标量来自共享毫升规范观测，缺测 ≠ 0）。
- `POST summary/generate`（同步；队列不可用时直接返回摘要）/
  `POST summary/generate/async`（返回 jobId）/ `GET summary/generate/status/:jobId`
  / `POST summary/generate/stream`（SSE）。AI 摘要受用户设置
  `aiSummariesEnabled` 门禁。
- `POST clinic-summary/preview` / `POST clinic-summary/preview/pdf`（同步，
  `pdfBase64`）/ `POST clinic-summary/share` / `GET clinic-summary/shares` /
  `GET clinic-summary/shared/:token`（无鉴权公开访问）/ `DELETE
clinic-summary/shares/:shareId`（撤销，204）/ `POST clinic-summary/export/async`
  - `GET clinic-summary/export/status/:jobId`（响应含 `jobId`/`pdfBase64`
    之一，互斥字段不双必需）/ `GET clinic-summary/shared/:token/pdf`（公开）。
- `GET reviews/current`（无事件返回 200 + null，不 404）/ `GET reviews`
  （`startedAt|id` 复合 cursor 分页，`limit` 1–100 默认 20，可选 status 过滤，
  坏 cursor 400）/ `GET reviews/:eventId`。

## 内部结构

四层迁移进行中（`plans/2026-10-26-ddd-migration-completion.md`）。已完成
`event-review` 与 `dashboard` 子域，`ai-summary` / `clinic-summary` 仍为旧结构。

- `adapters/http/controllers/event-review.controller.ts` — 事件回顾三个只读端点。
- `adapters/http/dto/` — `event-review-list-query` / `event-review-response`
  （zod schema）。**形状归应用层**：读模型产出的类型定义在
  `application/ports/event-review.ts`，DTO 只是校验与序列化，两者由
  `event-review-response.spec.ts` 的双向 `expectTypeOf` 钉住——单向断言只能发现
  「应用层缺字段」，发现不了「schema 加了字段而读模型从不填充」，而后者正是最
  容易发生的漂移方向。
- `application/ports/event-review.ts` — 事件回顾的读模型形状与查询入参词汇。
  手工镜像一份是因为 `ddd-application-no-infra-or-adapters` 禁止应用层 import
  投递层，方向反过来不成立。
- `application/read_models/event-review/` — facts（结构化事实码）/changes/actions/
  next-step（只读 medicines 的静态 `redFlags`，读失败降级空列表）/
  review（current/list/by-event 只读模型）/ fact-arguments。全部经 reader port
  读上游，**不直连 Prisma**。
- `application/ports/dashboard.ts` — 仪表盘用例的入参词汇
  （`ReportDashboardQuery`）、跨上下文读端口 `DashboardContextPort` 与其注入
  token `REPORT_DASHBOARD_CONTEXT`。**用例只依赖端口**，模块用
  `useExisting` 把 token 绑到 `adapters/acl/dashboard-context.ts`——反过来让用例
  直接注入 ACL 类会触发 `ddd-application-no-infra-or-adapters`。
- `application/read_models/dashboard/` — `report-range`（报告窗口词汇，
  产品决定，DTO 反向 re-export 以保导入路径不变）、`metrics.types`、
  `dashboard-computation`（指标计算，唯一入口 `compute`，内部仍调 presenter
  产出 findings/patterns——**计算与呈现尚未拆开，属已知的下一步**）、
  `dashboard-presenter`（本地化投影）。
- `application/use_cases/get-dashboard.ts` — 编排用例（缓存 + 版本号失效）。
- `adapters/acl/dashboard-context.ts` — 跨上下文数据收集：经
  `IUserSettingsPort` / `MedicineDoseLogReaderPort` / `DailyRecordReaderPort`
  三个 **reader port** 读上游，**不直连 Prisma**。
- `adapters/queue/cache-invalidation.ts` — 事件驱动缓存失效，按 ADR-0025 走
  `report-cache-invalidation` 队列，已无进程内监听器。
- `domain/dashboard/query-reasons.ts` — 「为什么这个指标缺测」的原因码，属领域词汇。
- `services/ai-summary/` — context/copy/generator/summary（继承
  `common/llm` 基类，bounded-linear 分层）+ `summary-queue.service`
  （异步队列）。
- `services/clinic-summary/` — summary（聚合）、share（token 分享）、
  pdf、pdf-queue。

## Dependencies

- 引用：`assistant`（`HistoricalAiSummaryService` 历史摘要）、
  `daily-records`、`health-events`、`medicines`（`MedicineRiskCheckService`
  静态红旗）、`medicine-dose-logs`、`user-settings`、`product-events`、
  LlmRuntime/LlmCommon。
- 被引用：`notification-preferences`（经 `IReportSummaryReader` port 生成
  周报洞察）、`data-export`（`ReportsService.getDashboard` 作为 PDF 数据源）。
- Barrel 导出：`ReportsService`、`ReportsAiSummaryService`、
  `EventReviewService`、`IReportSummaryReader`。

## Tests

`reports.controller.spec.ts`、`application/read_models/dashboard/*.spec.ts`、
`application/use_cases/get-dashboard*.spec.ts`、`adapters/acl/*.spec.ts`、
`services/ai-summary/*.spec.ts`、`services/clinic-summary/*.spec.ts`
（summary/share/pdf/pdf-queue）、`application/read_models/event-review/*.spec.ts`、
`adapters/http/dto/event-review-response.spec.ts` 与
`dto/report-dashboard-shape.spec.ts`（形状镜像守卫）、
`schemas/report-summary.schema.spec.ts`。
