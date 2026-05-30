# API Contract

Last updated: 2026-05-30

## Versioning

使用 NestJS 内置版本控制。全局 prefix 为 `/api`，版本通过 URI versioning 自动追加：

当前已实现的基线：

```text
GET /api/v1/health
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

Planned Phase 1 endpoints:

```text
GET /api/v1/medicines?source=cn&q=<keyword>&page=1&pageSize=20
GET /api/v1/medicines/:id?source=cn

GET /api/v1/medicines?source=drugbank&q=<keyword>&page=1&pageSize=20
GET /api/v1/medicines/:id?source=drugbank
```

Rules:

- `source=cn` queries Chinese product/package-insert rows from `cn_medicine_products`.
- `source=drugbank` queries English DrugBank scientific drug rows from `drugbank_drugs`.
- If `source` is missing, Lucent defaults to `drugbank` because the current product direction is knowledge-first personal health copilot.
- For `source=cn`, `:id` is the Lucent Chinese product id.
- For `source=drugbank`, `:id` is the primary DrugBank id such as `DB00001`.
- Unsupported source values should return HTTP 400 with code `400001`.
- `Accept-Language` can still be sent together with `source`; for example, `source=drugbank` and `Accept-Language: zh-CN` means "query DrugBank but localize Lucent wrapper/error text in Chinese where available".

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
