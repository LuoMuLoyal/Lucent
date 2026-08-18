# ADR-0003: API Envelope Contract

- **Status**: accepted (partially superseded by ADR-0012)
- **Date**: 2026-05-27
- **Deciders**: LuoMuLoyal

> ADR-0012 supersedes the error-response portion of this decision. This ADR remains authoritative
> only for the successful JSON response envelope.

## Context

The API needs a predictable successful response format so the Flutter client can decode endpoint
payloads consistently. The original decision also placed errors in the same envelope, but that made
HTTP failures appear successful to generic clients and retry infrastructure. The current error
contract is now defined by ADR-0012.

## Decision

Successful JSON API responses use this envelope:

```json
{
  "code": 0,
  "message": "",
  "data": { "id": "record_123" },
  "meta": { "traceId": "..." }
}
```

- `code` is always `0` for a successful response.
- `message` is empty for successful responses.
- `data` contains the endpoint payload and may be `null` for a successful empty operation.
- `meta` is optional and may contain safe diagnostic metadata such as `traceId`.
- The success envelope is documented in OpenAPI and is the generated-client success contract.
- Health checks remain successful envelope endpoints when they return JSON.

Ordinary HTTP 4xx and 5xx responses are not covered by this success envelope. They use RFC 9457
`application/problem+json` as specified by ADR-0012.

## Historical Options Considered

### One envelope for both success and failure

This was accepted in the original decision because it gave the client one parser. It is retained
here as historical context only. ADR-0012 replaces it because a non-zero business code inside HTTP
200 is misclassified by proxies, retries, caches, and generic clients.

### HTTP status codes with varied successful bodies

Rejected for successful responses. It would force the generated client to handle many endpoint
success shapes without the stable envelope.

### GraphQL

Rejected as over-engineered for this API.

## Consequences

- Successful endpoint DTOs continue to describe the success envelope.
- The error filter and error DTOs follow ADR-0012 rather than this ADR's historical numeric error
  envelope.
- OpenAPI export and Luminous client generation remain required when the success contract changes.
