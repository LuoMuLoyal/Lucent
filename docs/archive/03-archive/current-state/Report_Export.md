# Report Export

## 归档说明

本文档记录 2026 年中的功能实现状态快照，于 2026-08-01 归档至 `03-archive/current-state/`。实现状态以代码为准，历史信息可在此追溯。

Last updated: 2026-07-20

- Report export uses a shared `DataExportProcessorService` for both async (BullMQ) and inline
  fallback paths so the two execution modes run the same status, PDF generation, upload, and
  notification logic.
- When `REDIS_URL` is configured, `POST /api/v1/user/data-export-requests` enqueues a BullMQ job
  and immediately returns a `requested` row; otherwise it falls back to synchronous inline
  processing and returns the final state.
- Async worker failures mark the request `failed`, log the error, and let BullMQ retry the job with
  exponential backoff.
- Notification creation failures are swallowed so they do not break the export flow.
- PDF generation is pure pdf-lib drawing (no HTML-to-PDF). All rendering happens in
  `report-export-pdf-draw.service.ts` via `drawText`/`drawRectangle`/`drawLine` primitives.
- **Data-dense layout** — PDF presents all available `ReportDashboardDataDto` fields:
  - Overview: score value + status + per-metric contribution breakdown + summary
  - Key Metrics: 2-column card grid with label, value+unit, status badge, delta change, sparkline sequence
  - Daily Trends: tabular day-by-day breakdown of medication/water/sleep values from `trends[]`
  - Findings: insight blocks with title + body
  - Patterns: insight blocks with status badge, title, body, and sparkline sequence
- `ClinicSummaryService.buildClinicSummary()` 用户查询已迁移到 `prisma.nonDeleted.user.findFirstOrThrow` API。
- `GET /user/data-export-requests/latest` 只需 JWT 认证，不需要安全提权令牌。`POST /user/data-export-requests` 仍需提权。
