# ADR-0003: API Envelope Contract

- **Status**: superseded by ADR-0012
- **Date**: 2026-05-27
- **Deciders**: LuoMuLoyal

> This ADR records the historical envelope decision. The target HTTP response contract is defined
> by ADR-0012: successful responses return resource representations directly and ordinary HTTP
> failures use RFC 9457 Problem Details.

## Context

The original API used one generic `{ code, message, data }` envelope for successful and failed
responses. That shape made endpoint payloads less direct and allowed HTTP failures to look like
successful responses to generic clients. The target contract removes the generic success wrapper
and gives failures their own standard media type; implementation remains pending.

## Historical Decision

The API originally used this successful-response envelope:

```json
{
  "code": 0,
  "message": "",
  "data": { "id": "record_123" },
  "meta": { "traceId": "..." }
}
```

That decision is superseded. It remains in this ADR only as historical context for the contract
and generated-client changes that follow.

## Target Contract

Successful JSON responses return the endpoint's resource representation directly:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"record_123","date":"2026-08-21"}
```

- `GET` returns the requested resource or an explicit collection representation.
- `POST` may return `201 Created` with the created resource.
- `PUT`/`PATCH` may return the updated resource or `204 No Content` when no representation is
  needed.
- `DELETE` normally returns `204 No Content`.
- Collection pagination metadata belongs to the collection representation, such as
  `{ "items": [...], "nextCursor": "..." }`; it is not placed inside a generic `data` wrapper.
- OpenAPI success schemas describe the actual resource representation returned on the wire.

Ordinary HTTP 4xx and 5xx responses use RFC 9457 `application/problem+json` as specified by
ADR-0012.

## Historical Options Considered

### One envelope for both success and failure

Rejected. It made HTTP failures appear successful to proxies, retries, caches, and generic clients.

### HTTP status codes with endpoint-specific successful bodies

Accepted. HTTP status communicates the transport result, while each endpoint's schema describes its
resource representation directly.

### GraphQL

Rejected as over-engineered for this API.

## Consequences

- Successful endpoint DTOs describe resource representations rather than a generic envelope.
- OpenAPI export and Luminous client generation are required when the success contract changes.
- The old success envelope interceptor and explicit success wrappers must be removed or adapted
  during the contract migration.
- The error filter and error DTOs follow ADR-0012.
