# Error Contract Closeout Design

## Scope

This design closes the response-contract migration across Lucent and Luminous. It covers the
wire-level error representation, error taxonomy, descriptions, SSE error events, client parsing,
and contract tests. It deliberately excludes the separate neverthrow/Result migration: repository
and application return types remain unchanged in this work.

The ordinary HTTP success contract is already complete: JSON 2xx responses are endpoint resources,
`204` responses have no body, and ordinary HTTP failures use `application/problem+json`. The
remaining contract gap is that some SSE errors and some known backend failures still expose vague
or legacy-shaped payloads.

## Vocabulary and wire rules

### Ordinary HTTP errors

Every ordinary 4xx/5xx response uses this shape:

```json
{
  "type": "https://api.lumos.example/problems/auth-token-expired",
  "title": "Authentication token expired",
  "detail": "Your session has expired. Sign in again to continue.",
  "code": "AUTH_TOKEN_EXPIRED",
  "retryable": false,
  "retryAfter": 0,
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

Rules:

- `type` is a stable problem URI derived from the stable code.
- `code` is a documented string and never embeds the HTTP status.
- `title` is a specific error category and `detail` is a safe, request-specific, actionable
  description. Both are localized through the existing `AcceptLanguageResolver`/`I18nService`
  path using the request's `Accept-Language`; `type` and `code` remain language-independent.
  Clients never use `title` or `detail` for branching.
- `errors` is used for safe field-level validation details.
- `retryable` and `retryAfter` are hints only. Client retry still depends on HTTP method,
  idempotency, and the retry policy.
- The body never contains `status`, `statusCode`, `requestId`, stack traces, SQL, provider payloads,
  credentials, or raw internal exception messages.

### SSE error events

After an SSE response is established, HTTP status can no longer change. The `error` event therefore
uses the same Problem Details semantic fields and adds only an event-level stream status:

```json
{
  "type": "https://api.lumos.example/problems/dependency-unavailable",
  "title": "AI service temporarily unavailable",
  "detail": "The analysis service is unavailable. Retry this request later.",
  "code": "DEPENDENCY_UNAVAILABLE",
  "retryable": true,
  "retryAfter": 5,
  "status": "server_error"
}
```

Allowed stream statuses are `client_error`, `server_error`, `cancelled`, `server_shutdown`, and
`unknown`. `status` is never treated as an HTTP status code. Shutdown is represented as a specific
`SERVER_SHUTDOWN` code with a retryable detail, not as a bare `{ message, reason }` payload.

## Error taxonomy

The implementation will use the smallest catalog that still makes every known failure diagnosable.
Each entry has one stable code, one problem URI, localized title/detail keys, HTTP/SSE status
semantics, and retry metadata. Missing translations fall back through the existing i18n default
locale; the wire body never exposes a translation key.

| Category         | Representative codes                                                                                                                                                                        | Transport meaning                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Validation       | `VALIDATION_FAILED`, `INVALID_ARGUMENT`                                                                                                                                                     | 400; field errors when safe                           |
| Authentication   | `AUTH_REQUIRED`, `AUTH_TOKEN_EXPIRED`, `AUTH_REFRESH_TOKEN_INVALID`, `AUTH_WRONG_PASSWORD`, `AUTH_OAUTH_STATE_INVALID`, `AUTH_VERIFICATION_CODE_EXPIRED`, `AUTH_VERIFICATION_CODE_MISMATCH` | 400/401; refresh only for codes that can recover      |
| Authorization    | `FORBIDDEN`, `AUTH_ELEVATION_REQUIRED`, `AUTH_ELEVATION_TOKEN_INVALID`, `AUTH_SESSION_ACCESS_DENIED`                                                                                        | 403; never silently converted to 500                  |
| Resource state   | `RESOURCE_NOT_FOUND`, `NOTIFICATION_NOT_FOUND`, `LEGAL_DOCUMENT_NOT_FOUND`, `SUGGESTION_NOT_FOUND`, `REPORT_SHARE_NOT_FOUND`, `RESOURCE_CONFLICT`, `RECORD_ALREADY_EXISTS`                  | 404/409 with the affected operation named in detail   |
| Rate limiting    | `RATE_LIMITED`, `AUTH_LOGIN_RATE_LIMITED`, `AUTH_VERIFICATION_CODE_RATE_LIMITED`, `AUTH_VERIFICATION_CODE_COOLDOWN`                                                                         | 429; include `retryAfter` when known                  |
| Dependency       | `DEPENDENCY_UNAVAILABLE`, `DEPENDENCY_TIMEOUT`                                                                                                                                              | 502/503/504; retryable only when safe                 |
| Internal         | `INTERNAL_ERROR`                                                                                                                                                                            | 500; generic client detail, full server log and trace |
| Stream lifecycle | `SERVER_SHUTDOWN`, `STREAM_CANCELLED`                                                                                                                                                       | SSE event status only; no fake HTTP status            |

Known domain failures must be mapped to the most specific entry. A known validation, auth,
conflict, not-found, rate-limit, or dependency failure must not reach the client as `INTERNAL_ERROR`.
Unknown programming and infrastructure failures are the explicit exception: they use
`INTERNAL_ERROR` while retaining diagnostic detail only in logs and tracing.

## Data flow and boundaries

```text
known backend failure
        │
        ├─ ordinary HTTP ──> Problem Details filter ──> application/problem+json
        │
        └─ established SSE ─> SSE Problem Details mapper ─> event: error

Luminous HTTP response ──> strict ProblemDetails parser ──> LucentFailure
Luminous SSE error event ─> strict SSE ProblemDetails parser ─> LucentFailure
```

The client will not parse the retired `{ code, message, data }` error shape and will not recover
missing fields with a compatibility fallback. Parsing failures remain explicit protocol errors.
The neverthrow/Result boundary is not introduced here.

## Implementation slices

1. Add the canonical backend error catalog and Problem Details/SSE builders, with tests for every
   category and for unknown-error sanitization.
2. Replace the remaining SSE error payload helpers in Assistant, Today Analysis, and Reports;
   update shutdown handling to the same event contract.
3. Audit known controller/service failures so they preserve their real 4xx/5xx status and map to a
   specific stable code, title, and actionable detail instead of a generic 500.
4. Add or update OpenAPI Problem Details response schemas and backend contract tests for validation,
   auth, forbidden, conflict, not-found, rate-limit, dependency, and internal errors.
5. Add the strict Luminous SSE parser and migrate SSE tests and UI-facing error mapping to
   `LucentFailure`; remove SSE-specific legacy numeric error parsing only after the new tests pass.
6. Update both repositories' contract docs and migration logs, run all required checks, and make
   fine-grained atomic commits per slice.

## Acceptance criteria

- No ordinary HTTP error or SSE `error` event uses a bare message, numeric business code, or
  `statusCode` field.
- Known failures preserve a useful status and stable code; the client can tell auth, validation,
  conflict, not-found, rate-limit, dependency, and internal failures apart.
- `title` is specific and `detail` explains what happened and what the caller can do next without
  leaking sensitive internals.
- HTTP and SSE client tests reject legacy error shapes and parse the target shapes into
  `LucentFailure`.
- No neverthrow/Result migration is included in these changes.
- Both repositories pass their static analysis, contract tests, docs checks, and applicable build
  checks; any unrelated Flutter environment failure is recorded separately rather than hidden.
