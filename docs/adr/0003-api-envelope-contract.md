# ADR-0003: API Envelope Contract

- **Status**: accepted
- **Date**: 2026-05-27
- **Deciders**: LuoMuLoyal

## Context

The API needs a consistent response format so the Flutter client can handle success and error cases uniformly. Without a contract, each endpoint could return different shapes, forcing the client to write per-endpoint error handling.

## Decision

All API responses use a uniform envelope:

```json
{
  "code": 0,
  "message": "ok",
  "data": { ... }
}
```

- `code`: numeric status code. `0` = success. Non-zero codes follow a `HHHSSS` schema (HTTP status prefix + endpoint-specific suffix).
- `message`: human-readable message (localized via i18n).
- `data`: endpoint-specific payload. `null` for empty responses.

## Options Considered

| Option                                     | Pros                                            | Cons                                                       |
| ------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------- |
| Uniform envelope                           | Single client parser, consistent error handling | Slightly more bytes on wire, nesting                       |
| HTTP status codes only, varied body shapes | Lean responses                                  | Inconsistent error detail, client must handle per-endpoint |
| GraphQL                                    | Self-documenting, client-specified fields       | Over-engineered for this use case, adds complexity         |

## Consequences

- Flutter client uses a single `ApiResponse<T>` wrapper for all endpoints
- Error codes are documented in the generated OpenAPI spec via DTO decorators
- ValidationPipe errors map to consistent error codes (e.g., 400002 for validation failures)
- Health check endpoints also follow the envelope (`/health`, `/health/live`, `/health/ready`, `/health/deep`)
