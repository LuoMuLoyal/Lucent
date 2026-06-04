# API Contract

Last updated: 2026-06-04

## Versioning

使用 NestJS 内置版本控制。全局 prefix 为 `/api`，版本通过 URI versioning 自动追加：

当前已实现的基线：

```text
GET /api/v1/health
GET /api/v1/medicines
GET /api/v1/medicines/:id
GET /api/v1/me/health-context
PATCH /api/v1/me/health-context/profile
POST   /api/v1/me/health-context/allergies
PATCH  /api/v1/me/health-context/allergies/:id
DELETE /api/v1/me/health-context/allergies/:id
POST   /api/v1/me/health-context/conditions
PATCH  /api/v1/me/health-context/conditions/:id
DELETE /api/v1/me/health-context/conditions/:id
POST   /api/v1/me/health-context/current-medicines
PATCH  /api/v1/me/health-context/current-medicines/:id
DELETE /api/v1/me/health-context/current-medicines/:id
```

已实现：

```text
GET    /api/v1/me/daily-records?date=YYYY-MM-DD&kind=&page=1&pageSize=50
POST   /api/v1/me/daily-records
PATCH  /api/v1/me/daily-records/:id
DELETE /api/v1/me/daily-records/:id
GET    /api/v1/me/daily-records/summary?date=YYYY-MM-DD
```

Legacy Express `/api/*` routes are reference material only. Lucent does not need to keep their request bodies or response envelope.

## Response Envelope

Default success response:

```json
{
  "code": 0,
  "message": "",
  "data": {}
}
```

Default error response:

```json
{
  "code": 401001,
  "message": "Unauthorized",
  "data": null
}
```

Paginated response:

```json
{
  "code": 0,
  "message": "",
  "data": [],
  "meta": {
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 0,
      "totalPages": 0
    }
  }
}
```

Rules:

- `code` is an integer. `0` means success; non-zero means failure.
- `meta` is optional and should appear only when the response has pagination or real response-level metadata.
- `timestamp` stays in server logs by default and is not part of the body.
- `requestId` is returned in the `X-Request-Id` response header and included in server logs; clients only read it for support/debug flows.
- Business and validation failures should use appropriate HTTP status codes instead of returning every failure as HTTP 200.
- `message` is human-readable and can be localized later.

## Headers

Lucent should return:

```text
X-Request-Id: <request-id>
```

Clients do not need to parse it during normal flows. It exists for issue reports and log correlation.

Lucent also reads:

```text
Accept-Language: en | zh-CN
```

Current fallback behavior:

- If the client sends no language header, Lucent falls back to `en`.
- Clients that need Chinese responses should explicitly send `Accept-Language: zh-CN`.

`Accept-Language` is not a medicine database selector. It controls localized response messages and generic text only.

## Medicine Source Selection

Chinese and English medicine data are imported into separate Lucent tables. Frontend clients must tell Lucent which medicine source they want when calling medicine search/detail APIs.

Use a query parameter:

```text
source=cn
source=drugbank
```

Current Phase 1 endpoints:

```text
GET /api/v1/medicines?source=cn&q=<keyword>&page=1&pageSize=20
GET /api/v1/medicines/:id?source=cn

GET /api/v1/medicines?source=drugbank&q=<keyword>&page=1&pageSize=20
GET /api/v1/medicines/:id?source=drugbank
```

Optional request header for one-off freshness:

```text
x-bypass-cache: true
```

Rules:

- `source=cn` queries Chinese product/package-insert rows from `cn_medicine_products`.
- `source=drugbank` queries English DrugBank scientific drug rows from `drugbank_drugs`.
- If `source` is missing, Lucent defaults to `drugbank` because the current product direction is knowledge-first personal health copilot.
- For `source=cn`, `:id` is the Lucent Chinese product id.
- For `source=drugbank`, `:id` is the primary DrugBank id such as `DB00001`.
- Unsupported source values should return HTTP 400 with code `400001`.
- `Accept-Language` can still be sent together with `source`; for example, `source=drugbank` and `Accept-Language: zh-CN` means "query DrugBank but localize Lucent wrapper/error text in Chinese where available".
- Search responses use the common pagination envelope shape with `meta.pagination`.
- `x-bypass-cache: true` bypasses medicines read cache for the current request only. It does not invalidate shared cache for other callers.

The two medicine sources have different fields. API responses should not flatten them into a fake shared schema. Use a common shell plus a source-specific `detail` payload.

Search item shape:

```json
{
  "id": "DB01050",
  "source": "drugbank",
  "name": "Ibuprofen",
  "subtitle": "CAS 15687-27-1",
  "summary": "A non-steroidal anti-inflammatory drug...",
  "tags": ["approved", "small molecule"],
  "imageUrl": null,
  "matchedBy": ["name"]
}
```

Detail shape:

```json
{
  "id": "DB01050",
  "source": "drugbank",
  "name": "Ibuprofen",
  "subtitle": "CAS 15687-27-1",
  "detail": {
    "kind": "drugbank",
    "description": "...",
    "indication": "...",
    "mechanismOfAction": "...",
    "pharmacodynamics": "...",
    "drugInteractions": []
  }
}
```

```json
{
  "id": "cn_...",
  "source": "cn",
  "name": "布洛芬缓释胶囊",
  "subtitle": "0.3g / 某某制药",
  "detail": {
    "kind": "cnProduct",
    "approvalNumber": "...",
    "manufacturer": "...",
    "packageSpec": "...",
    "indications": "...",
    "dosage": "...",
    "contraindications": "..."
  }
}
```

Rationale:

- A query parameter is explicit, easy to inspect in logs, cache-friendly, and works naturally for search/detail links.
- A custom request header such as `X-Medicine-Source` is not recommended for normal product flows because it hides a user-visible data choice outside the URL.
- Request body selection is not recommended for `GET` search/detail APIs.
- A common shell plus source-specific detail keeps Flutter UI stable without losing fields that only exist in one source.

## Error Codes

Lucent uses **numeric error codes** mapped automatically by `ApiExceptionFilter` from NestJS standard exceptions:

| NestJS Exception          | HTTP | `code`   | 说明                               |
| ------------------------- | ---- | -------- | ---------------------------------- |
| `BadRequestException`     | 400  | `400001` | 请求参数错误                       |
| `ValidationPipe` 自动校验 | 400  | `400002` | DTO 字段校验失败（message 含详情） |
| `UnauthorizedException`   | 401  | `401001` | 未认证                             |
| —                         | 401  | `401002` | Token 过期                         |
| —                         | 401  | `401003` | Refresh Token 无效                 |
| `ForbiddenException`      | 403  | `403001` | 无权限                             |
| `NotFoundException`       | 404  | `404001` | 资源不存在                         |
| —                         | 409  | `409001` | 业务冲突（如重复添加）             |
| 未捕获异常                | 500  | `500001` | 内部错误                           |
| —                         | 500  | `500002` | 数据库错误                         |
| —                         | 500  | `500003` | 第三方服务超时/失败                |

### 使用方式

开发者抛标准 NestJS 异常即可，filter 自动映射：

```typescript
throw new BadRequestException('Missing required field');
// → { code: 400001, message: 'Missing required field', data: null }

throw new UnauthorizedException('Token expired');
// → { code: 401001, message: 'Token expired', data: null }
```

### 自定义业务错误码（按需添加）

```typescript
throw new BadRequestException({
  code: 400100, // custom business code
  message: '该药品已在你的列表中',
});
```

## Auth

Protected APIs must use Passport JWT guards. User-scoped handlers derive the user id from JWT payload, not from request-body `userId`.

Request-body `userId` must not be used as an authorization boundary.

Registration requires a verification code issued by `POST /api/v1/auth/send-verification-code` with `scene=register`. `RegisterDto` requires `email`, `password`, and `code`; a successful registration marks the email as verified.

Current auth compatibility notes:

- Email identity is case-insensitive; Lucent trims and lowercases email before lookup/persistence.
- Auth responses still expose `emailVerified: boolean` for frontend compatibility, but persistence uses `emailVerifiedAt`.
- Refresh tokens are opaque session secrets, not JWTs. Lucent stores only their hash in `user_sessions`.

## User Health Context

Current authenticated aggregate endpoint:

```text
GET /api/v1/me/health-context
Authorization: Bearer <accessToken>
```

```text
PATCH /api/v1/me/health-context/profile
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Contract notes:

- Returns `summary`, `profile`, `allergies`, `conditions`, and `currentMedicines` in one envelope.
- `profile` shape is stable and null-safe even if the stored relation row is missing.
- Day-level medical dates use `YYYY-MM-DD`.
- Timestamp fields use ISO 8601 strings.
- `PATCH /me/health-context/profile` currently supports partial updates for `locale`, `timezone`, and `unitSystem`.
- `PATCH /me/health-context/profile` returns the refreshed aggregate payload after the write succeeds.
- Sending `null` or an empty string for `locale` / `timezone` clears the stored preference.
- Other profile fields remain read-only in the current phase; the aggregate is still the main backend-facing payload for personalized Today flows.

## Daily Records (proposed)

Schema and migration exist (`prisma/migrations/20260604000000_add_user_daily_records`); APIs are not yet implemented.

### Planned endpoints

```text
GET    /api/v1/me/daily-records?date=YYYY-MM-DD&kind=&page=1&pageSize=50
POST   /api/v1/me/daily-records
PATCH  /api/v1/me/daily-records/:id
DELETE /api/v1/me/daily-records/:id
GET    /api/v1/me/daily-records/summary?date=YYYY-MM-DD
```

### Planned contract

- All endpoints are auth-protected and scoped to `CurrentUser.sub`.
- `GET /daily-records` returns paginated records for the given date, optionally filtered by `kind`.
- `POST /daily-records` creates a record: `kind` (required enum), `occurredAt` (YYYY-MM-DD), `title`, `value`, `unit`, `note`.
- `PATCH /daily-records/:id` supports partial update with omitted/no-change semantics.
- `DELETE /daily-records/:id` soft-deletes via `deletedAt`.
- `GET /daily-records/summary` returns counts by kind for the given date plus the most recent record per kind.
- No AI interpretation, diagnosis, or nutrition inference. This is manual user logging only.
