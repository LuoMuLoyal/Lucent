# ADR-0012: Error Contract and Result Boundary

- **Status**: accepted
- **Date**: 2026-08-18
- **Deciders**: LuoMuLoyal
- **Supersedes**: the error-response portion of ADR-0003

## Context

Lucent and Luminous have accumulated several overlapping error conventions: HTTP exceptions,
`{ code, message, data }` error envelopes, numeric codes that repeat the HTTP status, and
unclassified thrown errors. This is difficult for humans and AI-assisted development to apply
consistently. It also allows an HTTP 200 response to carry a business failure, which confuses
retry, generated clients, and observability systems.

The API needs one explicit transport contract and one explicit application boundary. The contract
must remain safe for clients, preserve distributed-trace correlation, and keep unexpected failures
diagnosable without exposing implementation details.

## Decision

### 1. Separate success and failure representations

Successful JSON responses retain the established success envelope:

```json
{
  "code": 0,
  "message": "",
  "data": { "id": "record_123" },
  "meta": { "traceId": "4bf92f3577b34da6a3ce929d0e0e4736" }
}
```

`code: 0` is the only success code. `data` may be `null` for a successful empty operation.
The success envelope remains the generated-client contract and is not replaced by a bare DTO.

All ordinary HTTP 4xx and 5xx responses use RFC 9457 Problem Details:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
```

```json
{
  "type": "https://api.lumos.example/problems/record-conflict",
  "title": "Record conflict",
  "detail": "A record already exists for this date.",
  "code": "RECORD_ALREADY_EXISTS",
  "retryable": false,
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

Problem Details must not be wrapped in the success envelope.

### 2. Define the sources of truth

- HTTP status is the only transport-status authority.
- `code` is a stable, documented, string business code. It must not encode the HTTP status.
- `type` is a stable, documentable problem URI.
- `title` is a short stable summary; `detail` is request-specific readable detail.
- `errors` is an optional safe structured validation payload.
- `retryable` and `retryAfter` are optional server hints and never override HTTP method idempotency,
  retry policy, or `Retry-After`.
- `traceId` is optional diagnostic correlation data and is never used for business decisions.

Ordinary Problem Details must not include `status`, `statusCode`, `requestId`, stack traces, SQL,
provider payloads, prompts, credentials, or internal URLs. `requestId` is retired by ADR-0010.

The invariants are mandatory:

1. Every 2xx JSON response is a successful envelope with `code: 0`.
2. Every ordinary 4xx/5xx JSON response is `application/problem+json` with an HTTP-consistent
   `code` and `type`.
3. A business failure is never represented by HTTP 200.
4. Clients branch on HTTP status and stable codes, never on `message` or `detail`.

### 3. Define the application Result boundary

Expected, recoverable domain failures are represented by `neverthrow` `Result`/`ResultAsync`:

```ts
ResultAsync<Record, DomainFailure>;
```

Lucent exposes this dependency through a project-owned `common/result` entry point. Business code
must not import the third-party package from arbitrary paths. The project entry point is the only
place that may change if the library is replaced.

`DomainFailure` is the domain-level failure vocabulary. `ProblemDetails` is the HTTP response
vocabulary. A single mapper converts `DomainFailure` to HTTP status and Problem Details; the Result
library does not define HTTP responses.

Lucent uses `neverthrow` rather than `@backendkit-labs/result`, `@sapphire/result`, or `antithrow`.
The latter candidates were evaluated and rejected for this architecture. In particular, Lucent
must not use `@backendkit-labs/result/nestjs`, `ResultInterceptor`, `ResultModule`, or `@AsResult()`:
that integration emits an incompatible `{ ok, data }` shape and can turn failures into normal HTTP
responses.

### 4. Define the exception boundary

The following are not disguised as domain failures:

- programming errors and violated invariants;
- configuration errors;
- cancellation and stream interruption;
- unclassified Prisma, Redis, LLM, or other infrastructure failures;
- NestJS guard, pipe, interceptor, and framework failures.

These may throw. They must be recorded with the active OTel context and converted by the final
HTTP filter into a safe Problem Details response. No catch may silently discard an error. An
intentional fallback must have an explicit degraded outcome, structured warning/error logging,
an OTel event/metric, and a test.

SSE is a transport exception: once the stream is established its HTTP status cannot change. Its
`event: error` payload uses the same `type`, `title`, `code`, and retry semantics; an event-only
`status` describes the stream termination reason and is not an HTTP status response.

## Options Considered

### Keep one `{ code, message, data }` envelope for all responses

Rejected. It makes HTTP failures look successful to generic clients and retries, and it keeps two
status authorities in the body and the HTTP response.

### Use `@backendkit-labs/result` and its NestJS integration

Rejected. Its current NestJS normalizer emits `{ ok, data }`/`{ ok, error }`, which conflicts with
RFC 9457 and the existing success contract. Its early version is also not a reason to delegate the
HTTP boundary to a dependency.

### Use `neverthrow` for the domain boundary and own the HTTP mapper

Accepted. `ResultAsync` provides mature asynchronous composition and explicit failure types while
leaving the API contract, HTTP status mapping, and OTel integration under project control.

## Consequences

- Controllers and application services must use one project Result boundary for expected failures.
- The global exception filter becomes the final safety net for unexpected failures, not the normal
  business-control-flow mechanism.
- The existing success interceptor remains, while the error filter changes to Problem Details.
- OpenAPI and generated clients must be regenerated as one cross-repository contract change.
- The migration is intentionally a hard cut: after the migration window, old error envelopes,
  business uses of numeric `HHHSSS` codes, and unclassified business throws are removed rather than
  maintained as a permanent compatibility mode.
- OTel remains responsible for correlation, error events, metrics, and degraded-operation visibility;
  it does not replace Result or the HTTP contract.

## References

- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- Luminous research: `research/03-技术决策/api-response-error-contract-响应信封与问题详情.md`
- [ADR-0003: API Envelope Contract](0003-api-envelope-contract.md)
- [ADR-0010: OpenTelemetry tracing](0010-otel-tracing.md)
