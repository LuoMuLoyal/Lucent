# Data Export Contract

本文件是 [[mine-settings-contract]] 拆分后的子文档。

相关子文档：

- [[app-info-contract]]

### 5. Data Export Requests

**Endpoints:**

```text
POST /api/v1/user/data-export-requests
GET  /api/v1/user/data-export-requests/latest
```

Both require authentication and a valid `x-security-elevation` Bearer token (obtained from `POST
/api/v1/settings/security-pin/verify`).

**POST Body:**

```typescript
interface CreateDataExportRequestDto {
  kind?: 'hospital' | 'monthly' | 'print';
  format?: 'pdf'; // only pdf is supported right now
  range?: 'last_7_days' | 'last_30_days';
}
```

**POST Response (201):** `DataExportRequestDto`

Lucent persists the request row first, then tries to generate the export immediately.
When the BullMQ queue is unavailable (Redis not configured, or enqueue fails at
runtime), the request is processed inline synchronously instead of returning an
error — the response reflects the completed export in that case.
Current real implementations are:

- `hospital + pdf + last_7_days`
- `monthly + pdf + last_30_days`
- `print + pdf + last_7_days`

**GET Response:** `DataExportRequestDto | null`

Returns the most recent export request for the authenticated user, or `null`
if none exists.

```typescript
interface DataExportRequestDto {
  id: string;
  kind: 'hospital' | 'monthly' | 'print';
  format: 'pdf';
  range: 'last_7_days' | 'last_30_days';
  status: 'requested' | 'processing' | 'completed' | 'failed' | 'unavailable';
  requestedAt: string; // ISO-8601
  completedAt: string | null;
  downloadUrl: string | null; // short-lived signed GET URL when completed
  fileName: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
}
```

**Current behavior:**

- If Tencent COS export storage is not configured, POST still creates a row but
  returns status `unavailable`.
- If the export succeeds, Lucent uploads the PDF to COS, stores object metadata,
  and GET returns a short-lived signed download URL.
- `downloadUrl` should be treated as ephemeral; clients should refresh latest
  status before downloading again instead of caching the URL permanently.
- `monthly` requests are normalized to `last_30_days` before Lucent stores and generates the export,
  even if the caller passes another range value.
- `ClinicSummaryService` user lookup migrated to `prisma.nonDeleted.user.findFirstOrThrow` API.
- Report summary and clinic PDF async-queue fallback (`enqueueOrFallback`) now accepts an
  injected `Logger` instance from the controller for testability and consistent log context.
- Report dashboard medication adherence now uses independent reminder slots and an observed
  metric. Temporary dose logs without a reminder are retained as facts but excluded from the
  planned-slot denominator; no planned slots returns unknown rather than zero adherence.
- Report dashboard scalar water values used by compatible export paths are derived from the shared
  canonical milliliter observation. Missing days remain unknown in the source metric and are not
  counted as zero-liter intake when computing averages.
- Report metric scalar fields remain a deprecated compatibility projection while the coverage-aware
  observed metric (`value`, `state`, `coverage`, `sources`, counts, and window) is the contract for
  new consumers. Export paths must keep missing observations distinct from an observed zero.
- The Event Review read model added to the reports module (review DTO, read service skeleton, and
  health-event ownership read façade) is read-only and changes no export endpoint or DTO; export and
  clinic summary remain reachable through their existing endpoints and become More actions in the
  Review UI rather than primary-path features. The review history list uses a composite
  `startedAt|id` opaque cursor and `unknown` sections with fixed reason codes; neither concept
  applies to the export DTOs above. The four review sections emit structured fact codes and
  arguments (localized by the client) with fixed reason codes for unknown sections; red flags stay
  limited to the reviewed static medication rules, so no free-text review copy enters the export
  contract. Known limitations: red flags are user-level static risk results and are not aligned to
  the event's medicines (a follow-up extends the risk payload with medicine ids or filters per
  event), and change trends compare only the first and last observation of the window — a simplified
  factual direction, not a regression analysis.
- Review Experience Task 3 wires the read-only review endpoints (`GET
/api/v1/user/reports/reviews/current`, `/reviews`, `/reviews/:eventId`) into the reports
  controller and exports them to `docs/openapi.json` (117 paths). The review list is
  cursor-paginated (`startedAt|id` composite cursor) with an optional status filter and no
  7/30-day default contract; none of this changes the data-export request/response DTOs, and the
  existing dashboard/summary/clinic-summary endpoints keep their response shapes for one
  compatibility cycle.
- The review list `limit` query parameter is documented in the OpenAPI schema as an integer with
  `minimum: 1` and `maximum: 100` (default 20), matching the runtime `@IsInt`/`@Min`/`@Max`
  validation; malformed cursors are rejected with 400 before any repository read.

### Clinic Summary 分享/预览响应

`POST /clinic-summary/preview`、`GET /clinic-summary/shared/{token}` 的成功响应直接返回
`ClinicSummaryDto`；`POST /clinic-summary/share` 的成功响应直接返回
`ClinicSummaryShareDataDto`。错误响应使用 `application/problem+json`。
