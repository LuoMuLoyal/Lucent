# DomainFailure + ResultAsync Boundary Design

## Scope

This slice establishes Lucent's application-level failure seam for the separate
neverthrow migration. It adds the project-owned Result entry point, the
`DomainFailure` vocabulary, and the single mapper from domain failures to the
existing Problem Details catalog.

It does not migrate any repository, application service, controller, guard,
queue, or infrastructure adapter. It does not change the HTTP wire contract,
the SSE contract, Luminous, or the existing exception filter behavior.

## Goals

- Pin `neverthrow` to the version selected for this migration and prevent
  business code from importing it from arbitrary package paths.
- Expose the small Result surface needed by future domain migrations through
  `src/common/result/index.ts`.
- Define a typed `DomainFailure` value that contains domain failure semantics,
  not HTTP status or localized presentation text.
- Provide one mapper that delegates stable code/status/localization decisions to
  the existing `ProblemCatalog`.
- Make the new seam independently testable before any production domain adopts
  it.

## Non-goals

- No repository or application method changes in this slice.
- No conversion of existing `throw`, `Promise<T>`, `AppError`, or HTTP
  exceptions.
- No Result interceptor, Nest module, controller wrapper, or `{ ok, data }`
  response shape.
- No compatibility adapter from old application errors to Result. Adapters will
  be added only at the concrete domain seams that are migrated later.

## Module interfaces

### Project-owned Result entry point

`src/common/result/index.ts` is the only import surface for the selected
third-party Result implementation. It explicitly re-exports:

- `Result` and `ResultAsync`;
- `ok`, `err`, `okAsync`, and `errAsync`;
- `fromPromise` for converting an asynchronous operation at a future adapter
  seam;
- the `DomainFailure` type, `DomainFailureCode`, `DomainFailureKind`, the
  constructor, type guard, and mapper defined below.

The entry point does not export a NestJS integration or a project-specific
wrapper class. Callers should use `ResultAsync<T, DomainFailure>` directly.

### DomainFailure

`src/common/result/domain-failure.ts` defines:

```ts
export type DomainFailureKind =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'dependency'
  | 'internal';

export type DomainFailureCode = Exclude<
  ProblemCode,
  'SERVER_SHUTDOWN' | 'STREAM_CANCELLED'
>;

export interface DomainFailure {
  readonly _tag: 'DomainFailure';
  readonly kind: DomainFailureKind;
  readonly code: DomainFailureCode;
  readonly detail?: string;
  readonly errors?: Readonly<Record<string, unknown>>;
  readonly retryable?: boolean;
  readonly retryAfter?: number;
  readonly cause?: unknown;
}
```

`DomainFailure` deliberately has no HTTP `status`, `statusCode`, `type`,
localized `title`, or request/trace identifier. The stable code is shared with
the Problem Details catalog so the mapper cannot emit an undocumented domain
code. `cause` is diagnostic-only and is never serialized by the mapper.

The module exposes `createDomainFailure(input)` and `isDomainFailure(value)`.
The constructor rejects empty codes, invalid kinds, negative/non-finite
`retryAfter` values, and non-object `errors`. It returns an immutable-shaped
value but does not deep-freeze caller-owned metadata.

### DomainFailure mapper

`src/common/result/domain-failure.mapper.ts` defines a small
`DomainFailureMapper` module:

```ts
toProblemDetails(
  failure: DomainFailure,
  options: { catalog: ProblemCatalog; lang: string; traceId?: string },
): ProblemDetails;
```

The mapper passes `failure.code`, safe detail/error data, retry metadata, and
trace correlation to `ProblemCatalog.build`. The catalog remains the only
source of HTTP status, problem URI, and localized title/detail. The mapper
never serializes `cause`, and it throws if a future caller circumvents the
typed constructor with an invalid code or an invalid failure value.

The mapper is a plain module rather than a Nest provider in this slice. That
keeps the seam usable by application code and tests without changing module
wiring. A later migration may register it as a provider when a concrete domain
needs dependency injection.

## Data flow after this slice

```text
future repository/application
        │
        └── ResultAsync<T, DomainFailure>
                │
                ├── Ok(T) → controller returns T
                └── Err(DomainFailure) → one mapper → ProblemCatalog → ProblemDetails filter
```

Existing code remains on its current exception path until a domain is migrated.
There is no runtime dual wire contract: this slice only adds an unused internal
seam and does not alter current HTTP behavior.

## Testing strategy

- `src/common/result/domain-failure.spec.ts` verifies constructor invariants,
  the `_tag` discriminator, preservation of safe detail/errors/retry metadata,
  rejection of transport-only codes, and `isDomainFailure` behavior.
- `src/common/result/domain-failure.mapper.spec.ts` uses the existing
  `ProblemCatalog` with a deterministic i18n double and verifies that code,
  localized catalog output, validation errors, retry metadata, and trace ID are
  forwarded while `cause` is omitted.
- `src/common/result/index.spec.ts` verifies the project-owned entry point can
  construct `Result` and `ResultAsync` values and that an `Err` carries a
  `DomainFailure` rather than an arbitrary error.

The focused Vitest suite must pass before the implementation is committed,
followed by Lucent typecheck, lint, build, and documentation checks. Since no
existing caller changes in this slice, no controller or e2e behavior is
expected to change.

## Commit boundary

This design and its implementation are separate commits. The implementation
commit contains only the dependency, `src/common/result/**`, and its tests.
Domain migrations are later commits split by bounded domain; they must not be
folded into this foundation commit.
