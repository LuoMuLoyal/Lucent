---
status: active
owner: backend
---

# data-export

报告 PDF 导出请求生命周期管理。注意命名边界：尽管叫 data-export，本模块
**不导出原始用户数据**，而是创建 `DataExportRequest` 记录并生成报告 PDF
（架构评审 #14 已固化该边界）。clinic-summary/review 相关端点属 `reports` 模块。

## Endpoints（挂 `/user` 前缀，事实源 = openapi.json）

- `POST /api/v1/user/data-export-requests` — 201 返回资源。body：
  `kind: 'hospital'|'monthly'|'print'`（默认 hospital）、`format: 'pdf'`、
  `range: 'last_7_days'|'last_30_days'`（默认 last_7_days）、`password`
  （敏感操作再认证，`PasswordReauthService`）。错误：401 再认证失败、
  409 唯一约束竞态、429 再认证限流、503 对象存储不可达。写操作记审计日志
  （audit-log）。
- `GET /api/v1/user/data-export-requests/latest` — 最近一条请求，无则 `null`。

## 请求生命周期

1. 先持久化请求行再尝试生成。
2. 对象存储（Tencent COS）未配置 → 行落库即 `status: 'unavailable'`，
   不是 HTTP 错误。
3. BullMQ 队列可用 → 异步入队（attempts 3，指数退避）；Redis 未配置或
   入队失败 → **同步 inline 兜底**，任务不丢，响应反映完成后的导出结果。
4. `monthly` 强制归一化为 `last_30_days` 再存储与生成。
5. 成功：PDF 上传 COS，存对象元数据，完成后发站内通知；`downloadUrl`
   是短时签名 URL（临时性），客户端再次下载前应刷新 latest。

`DataExportRequestDto`：`id/kind/format/range/status/requestedAt/completedAt/
downloadUrl/fileName/fileSizeBytes/errorMessage`，status 枚举
`requested|processing|completed|failed|unavailable`。依赖不可用返回本地化
Problem Details + 稳定依赖码，不暴露队列/提供方内部细节。

## 内部结构（services/）

- `export.service.ts` — 请求创建/再认证/存储未配置与队列降级编排。
- `queue.service.ts` — `data-export` BullMQ 队列封装。
- `processor.service.ts` — 调 `ReportsService.getDashboard` 取聚合数据，
  渲染 PDF，上传存储，更新状态，发完成通知。
- `storage.service.ts` — COS 上传与短时签名下载 URL。
- `report-pdf/`（pdf/draw/theme）— 报告 PDF 渲染与主题。

## Dependencies

- 引用：`auth`（PasswordReauthService）、`reports`（ReportsService 数据源）、
  `notifications`（完成通知）、`audit-log`、Prisma。
- 被引用：`app.module` 注册；无模块消费其导出。

## Tests

`data-export.controller.spec.ts`、`services/export.service.spec.ts`、
`queue.service.spec.ts`、`processor.service.spec.ts`、`storage.service.spec.ts`、
`utils/report-pdf.theme.spec.ts`。
