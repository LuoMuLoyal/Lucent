---
title: "Lucent API Contract"
tags:
  - backend
  - contract
aliases:
  - API协议
  - API规范
created: 2026-05-25
---

# API Contract

Last updated: 2026-05-26

## Versioning

Lucent APIs are versioned. The first public API lives under:

```text
/api/v1
```

Current implemented baseline:

```text
GET /api/v1/health
```

Legacy Express `/api/*` routes are reference material only. Lucent does not need to keep their request bodies or response envelope.

## Response Envelope

Default success response:

```json
{
  "code": "OK",
  "message": "",
  "data": {}
}
```

Default error response:

```json
{
  "code": "AUTH_UNAUTHORIZED",
  "message": "Unauthorized",
  "data": null
}
```

Paginated response:

```json
{
  "code": "OK",
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

- `ok` is omitted because `code === "OK"` and HTTP status already express success.
- `meta` is optional and should appear only when the response has pagination or real response-level metadata.
- `timestamp` stays in server logs by default and is not part of the body.
- `requestId` is returned in the `X-Request-Id` response header and included in server logs; clients only read it for support/debug flows.
- Business and validation failures should use appropriate HTTP status codes instead of returning every failure as HTTP 200.
- `code` values are stable machine-readable strings.
- `message` is human-readable and can be localized later.

## Headers

Lucent should return:

```text
X-Request-Id: <request-id>
```

Clients do not need to parse it during normal flows. It exists for issue reports and log correlation.

## Auth

Protected APIs must use Passport JWT guards. User-scoped handlers derive the user id from JWT payload, not from request-body `userId`.

Request-body `userId` must not be used as an authorization boundary.
