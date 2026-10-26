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

四层已完整落到 ADR-0024 骨架。

### adapters

- `http/controllers/` — `reports` / `clinic-summary` / `event-review` 三个控制器。
- `http/dto/` — 只有事件回顾的 DTO（`event-review-list-query` /
  `event-review-response`）。**其余响应/请求形状归应用层**（见下）；理由见
  「形状归属」。
- `acl/dashboard-context.ts` — 仪表盘跨上下文读：经 `IUserSettingsPort` /
  `MedicineDoseLogReaderPort` / `DailyRecordReaderPort` 三个 **reader port**
  取数，**不直连上游表**。
- `queue/` — `cache-invalidation`（ADR-0025，`report-cache-invalidation`）、
  `summary`、`clinic-summary-pdf`。

### application

- `ports/` — 六个端口：`dashboard`（`DashboardContextPort`）、`event-review`
  （读模型形状）、`clinic-summary`（`ClinicSummaryShares` /
  `ClinicSummarySources`）、`clinic-summary-pdf`、`summary`
  （`REPORT_SUMMARY_GENERATOR`）、`report-summary-output`、
  `report-summary-reader`。
- `use_cases/` — `get-dashboard`、`build-clinic-summary`、
  `clinic-summary-shares`、`generate-report-summary`（+ 命令与请求形状）。
- `read_models/` — `dashboard/`（计算、投影、窗口词汇、形状）、
  `event-review/`（facts/changes/actions/next-step/review）、
  `ai-summary/summary-context`、`clinic-summary-*`、`report-summary-*`。
- `services/summary-copy.ts` — 摘要多语言文案。

### domain

- `clinic-summary/share-access.ts` — 分享可达性谓词（未撤销且未过期）。
- `clinic-summary/share-scope.ts` — 分享范围校验。
- `dashboard/query-reasons.ts` — 「为什么这个指标缺测」的原因码。

### infrastructure

- `persistence/clinic-summary.ts` — `ClinicSummaryShares` / `ClinicSummarySources`
  的 Prisma 实现。
- `pdf/` — 门诊摘要 PDF 渲染（`document` + `clinical-drawers` /
  `record-drawers` / `copy`）。
- `llm/` — `summary-generator`（结构化输出）、`prompts/`、`schemas/`。

## 形状归属（重要）

`ddd-application-no-infra-or-adapters` 与 `ddd-infrastructure-no-adapters` 禁止
应用层/基础设施引用 `adapters/`。但读模型**产出**响应形状、PDF 渲染器**消费**它，
所以这些形状归 `application/`：

- `read_models/dashboard/dashboard-shapes.ts` 与
  `read_models/dashboard/report-dashboard-response.ts`、
  `read_models/clinic-summary-response.ts`、`read_models/report-summary-*`。
- **zod schema 与类型同源**：schema 留在文件里，DTO 侧只做 re-export，因此不会
  出现两份定义漂移。这条与事件回顾不同——那边 schema 在 `adapters/`，形状在
  `application/ports/event-review.ts`，由 `event-review-response.spec.ts` 的双向
  `expectTypeOf` 钉住。

**为什么不是所有 DTO 都这样**：只有被应用层/基础设施层真正引用的形状才内移；
纯 HTTP 形状（如 `event-review-*`）留在 `adapters/http/dto/`。

## 跨上下文读的口径

本模块**不直连任何上游表**：

| 数据                         | 来源                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| 日报                         | `daily-records` 的 `DailyRecordReaderPort`                    |
| 剂量日志                     | `medicine-dose-logs` 的 `MedicineDoseLogReaderPort`           |
| 用户设置                     | `user-settings` 的 `IUserSettingsPort`                        |
| 过敏/病史/当前用药/生日/性别 | `user-health-context` 的 `IUserHealthContextReader`           |
| 静态风险红旗                 | `medicines` 的 `MedicineRiskCheckService`（读失败降级空列表） |
| 昵称                         | 本模块 `ClinicSummarySources`（`user` 表自有列，经端口）      |

## Dependencies

- 引用：`assistant`（`HistoricalAiSummaryService` 历史摘要）、
  `daily-records`、`health-events`、`medicines`、`medicine-dose-logs`、
  `user-settings`、`user-health-context`、`product-events`、
  LlmRuntime/LlmCommon、`data-export`（PDF 绘制工具）。
- 被引用：`notification-preferences`（经 `IReportSummaryReader` 生成周报洞察）、
  `data-export`（`ReportsService.getDashboard` 作为 PDF 数据源）。
- Barrel 导出：`ReportsService`、`ReportsAiSummaryService`、
  `EventReviewService`、`IReportSummaryReader`。

## Tests

`reports.controller.spec.ts`、`application/**/*.spec.ts`、`adapters/**/*.spec.ts`、
`infrastructure/**/*.spec.ts`，以及两个形状镜像守卫：
`adapters/http/dto/event-review-response.spec.ts` 与
`adapters/http/dto/report-dashboard-shape.spec.ts`。
