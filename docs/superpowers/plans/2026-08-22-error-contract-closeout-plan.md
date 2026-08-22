# Error Contract Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the Lucent/Luminous transport error contract with specific localized Problem Details and SSE error events, without starting the separate neverthrow/Result migration.

**Architecture:** Lucent remains the source of truth for stable error codes, problem URIs, HTTP status mapping, and localized `title/detail` text. A shared backend mapper builds ordinary HTTP Problem Details and a parallel SSE event payload; the final HTTP filter and established SSE controllers consume those mappers. Luminous keeps strict wire parsing, maps both HTTP and SSE failures to `LucentFailure`, and never falls back to the retired numeric envelope.

**Tech Stack:** NestJS 11, `nestjs-i18n`, Fastify, OpenAPI/Swagger, Vitest, Flutter/Dart, Dio, generated `dart-dio` client.

---

## Task 1: Lock the error catalog and i18n resources

**Files:**

- Modify: `Lucent/src/common/api/problem-details.ts`
- Modify: `Lucent/src/common/api/result-code.ts`
- Create/modify: `Lucent/src/common/api/problem-catalog.ts`
- Create/modify: `Lucent/src/i18n/en/common.json`
- Create/modify: `Lucent/src/i18n/zh-CN/common.json`
- Test: `Lucent/src/common/api/problem-details.spec.ts`
- Test: `Lucent/src/common/api/problem-catalog.spec.ts`

- [ ] **Step 1: Write failing catalog tests** for `AUTH_TOKEN_EXPIRED`, `AUTH_WRONG_PASSWORD`, `VALIDATION_FAILED`, `RESOURCE_NOT_FOUND`, `RECORD_ALREADY_EXISTS`, `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE`, `INTERNAL_ERROR`, and `SERVER_SHUTDOWN`. Assert each code has an invariant URI, a localized title/detail key, status semantics, and retry metadata.

- [ ] **Step 2: Run the focused tests and confirm the catalog API is missing or incomplete.**

  Run: `pnpm vitest run src/common/api/problem-details.spec.ts src/common/api/problem-catalog.spec.ts`

- [ ] **Step 3: Implement the catalog.** Keep the wire `code` string and `type` URI invariant. Resolve `title` and `detail` through `I18nService` with the request language; use the existing default locale when a translation is unavailable. Do not put numeric legacy codes into the returned body.

- [ ] **Step 4: Run the focused tests again.**

  Expected: all catalog and Problem Details tests pass, including rejection of `statusCode`, `requestId`, and numeric `{ code, message, data }` bodies.

- [ ] **Step 5: Commit the backend catalog only.**

  `git add src/common/api src/i18n && git commit -m "refactor(contract): 建立错误目录与本地化语义"`

## Task 2: Make the HTTP Problem Details filter preserve precise errors

**Files:**

- Modify: `Lucent/src/common/filters/api-exception.filter.ts`
- Modify: `Lucent/src/common/helpers/errors/error-payload.ts` only if still used by SSE after Task 3
- Test: `Lucent/src/common/filters/api-exception.target.spec.ts`
- Test: controller/service contract tests covering auth, validation, conflict, not-found, rate-limit, dependency, and internal errors

- [ ] **Step 1: Add failing filter cases** for localized `Accept-Language`, a known `HttpException` with a stable code, validation arrays becoming `errors`, and an unknown exception becoming `INTERNAL_ERROR` without leaking the raw message.

- [ ] **Step 2: Run the focused filter/contract tests and record the current mismatches.**

  Run: `pnpm vitest run src/common/filters/api-exception.target.spec.ts src/common/filters/api-exception.filter.spec.ts`

- [ ] **Step 3: Implement the mapper/filter integration.** Inject `I18nService` into the filter, read the request language from `I18nContext.current(host)?.lang`, and resolve catalog translation keys with `{ lang }`. Preserve the original HTTP status, set `Content-Type: application/problem+json`, and use a specific catalog code whenever the exception is classifiable. Keep unknown exception details only in structured logs and trace context.

- [ ] **Step 4: Run focused tests and inspect serialized JSON.**

  Expected: no HTTP error body contains `statusCode`, `requestId`, a numeric business code, or an unlocalized generic message where a catalog entry exists.

- [ ] **Step 5: Commit the HTTP filter slice.**

  `git add src/common/filters src/common/api src/i18n && git commit -m "refactor(contract): 精确化 HTTP Problem Details"`

## Task 3: Replace every SSE error payload

**Files:**

- Modify: `Lucent/src/common/api/sse/sse.ts` or create `Lucent/src/common/api/sse/sse-error.ts`
- Modify: `Lucent/src/common/api/problem-details.ts`
- Modify: `Lucent/src/common/api/index.ts`
- Modify: `Lucent/src/common/helpers/errors/error-payload.ts`
- Modify: `Lucent/src/common/api/sse/sse-connection-registry.service.ts`
- Modify: `Lucent/src/modules/assistant/assistant.controller.ts`
- Modify: `Lucent/src/modules/today-analysis/today-analysis.controller.ts`
- Modify: `Lucent/src/modules/reports/reports.controller.ts`
- Test: `Lucent/src/common/helpers/errors/error-payload.spec.ts`
- Test: `Lucent/src/common/api/sse/sse-connection-registry.service.spec.ts`
- Test: `Lucent/src/modules/assistant/assistant.controller.spec.ts`
- Test: corresponding Today Analysis and Reports controller specs

- [ ] **Step 1: Write failing SSE tests** asserting `event: error` contains `type`, `title`, `detail`, `code`, optional `retryable/retryAfter`, and event-only `status`; assert it never contains `statusCode`, numeric codes, or a bare `{ message }` payload.

- [ ] **Step 2: Run the focused SSE tests and verify they fail against the current payloads.**

  Run: `pnpm vitest run src/common/helpers/errors/error-payload.spec.ts src/common/api/sse src/modules/assistant/assistant.controller.spec.ts`

- [ ] **Step 3: Implement one SSE error mapper.** Map known `HttpException`/domain failures through the catalog, map dependency failures to `DEPENDENCY_UNAVAILABLE` or `DEPENDENCY_TIMEOUT`, map cancellation to `STREAM_CANCELLED`, and map shutdown to `SERVER_SHUTDOWN`. Pass the resolved locale from the controller/request context into i18n. Never reuse the ordinary HTTP `status` field as an HTTP status in the event.

- [ ] **Step 4: Update all three streaming controllers and shutdown registry to call the mapper.** Remove `httpExceptionPayload` shapes that emit `{ message, code, statusCode }` and Assistant's `{ message }` shape.

- [ ] **Step 5: Run all SSE/controller tests.**

  Expected: all event payload assertions pass in English and Chinese, and client-visible detail is actionable without exposing internal exception text.

- [ ] **Step 6: Commit the SSE slice.**

  `git add src/common/api src/common/helpers/errors src/common/api/sse src/modules/assistant src/modules/today-analysis src/modules/reports && git commit -m "refactor(contract): 统一 SSE 错误事件"`

## Task 4: Audit known backend failures and descriptions

**Files:**

- Modify: affected services under `Lucent/src/modules/**/services/`
- Modify: affected controllers/guards/pipes under `Lucent/src/modules/**/controllers/`, `guards/`, and `pipes/`
- Test: the co-located specs for each changed service/controller/guard

- [ ] **Step 1: Inventory every `HttpException`, `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, rate-limit throw, and dependency catch.** Record the current HTTP status, intended stable code, and i18n key before editing.

- [ ] **Step 2: Add a failing contract assertion for each currently ambiguous case** where a known client error becomes 500 or a generic detail. The assertion must check status, stable code, localized title/detail, and retry metadata.

- [ ] **Step 3: Map each known case to the catalog without changing domain behavior.** Preserve 400/401/403/404/409/429/502/503/504 semantics; only unknown failures use `INTERNAL_ERROR`.

- [ ] **Step 4: Run the affected module tests and the complete backend contract suite.**

  Run targeted affected specs first, then the project default `pnpm test` and `pnpm test:contract`.

- [ ] **Step 5: Commit each module group separately.** Use one conventional commit per coherent error family, for example `refactor(auth): 明确认证错误契约` and `refactor(reports): 明确报告依赖错误契约`.

## Task 5: Add strict Luminous SSE parsing and failure mapping

**Files:**

- Modify/create: `Luminous/lib/core/network/problem_details.dart` or a focused SSE Problem Details parser
- Modify: `Luminous/lib/core/network/map_utils.dart`
- Modify: `Luminous/lib/core/network/error_mapper.dart`
- Modify: `Luminous/lib/features/assistant/data/datasources/assistant.dart`
- Modify: `Luminous/lib/features/today/data/datasources/ai_remote.dart`
- Modify: `Luminous/lib/features/report/data/datasources/ai_summary_remote.dart`
- Test: `Luminous/test/core/network/problem_details_test.dart`
- Test: `Luminous/test/core/network/target_error_contract_test.dart`
- Test: `Luminous/test/assistant/remote_data_source_stream_test.dart`
- Test: `Luminous/test/today/ai_remote_data_source_test.dart`
- Test: `Luminous/test/report/ai_summary_remote_data_source_test.dart`

- [ ] **Step 1: Write failing parser tests** for valid SSE Problem Details, localized text preservation, allowed stream statuses, retry metadata, and rejection of legacy numeric `{ message, code, statusCode }` events.

- [ ] **Step 2: Run the focused Dart tests and confirm the old parser fails the target shape.**

  Run: `flutter test test/core/network/problem_details_test.dart test/assistant/remote_data_source_stream_test.dart test/today/ai_remote_data_source_test.dart test/report/ai_summary_remote_data_source_test.dart`

- [ ] **Step 3: Implement strict SSE parsing to `LucentFailure`.** Keep stream termination status separate from HTTP status. Do not add fallback parsing.

- [ ] **Step 4: Update stream data sources and repository/provider error expectations.** Remove SSE-specific `LucentApiException` construction once all target tests pass.

- [ ] **Step 5: Run focused tests and Dart analysis.**

  Run: `dart analyze lib test` and the focused Flutter test command above.

- [ ] **Step 6: Commit the client SSE slice.**

  `git -C Luminous add lib test docs && git -C Luminous commit -m "refactor(contract): 切换 SSE 错误解析"`

## Task 6: Synchronize contract documentation and final gates

**Files:**

- Modify: `Lucent/docs/01-reference/adr/0012-error-contract-and-result-boundary.md`
- Modify: `Lucent/docs/01-reference/contracts/README.md` or the relevant streaming contract
- Modify: `Luminous/docs/00-current/Lucent_Contract_Snapshot.md`
- Modify: `Luminous/docs/02-reference/OpenApi_Client.md`
- Append: both repositories' dated migration logs
- Modify: `Lucent/docs/openapi.json` only through `pnpm export:openapi`

- [ ] **Step 1: Document the catalog, i18n rule, HTTP/SSE distinction, and examples.**

- [ ] **Step 2: Export and inspect OpenAPI.**

  Run in Lucent: `pnpm export:openapi`; verify Problem Details responses use the target schema and no success envelope schema returns.

- [ ] **Step 3: Regenerate the client.**

  Run in Luminous: `dart run scripts/bootstrap_generated_sources.dart`.

- [ ] **Step 4: Run final gates.**

  Lucent: `pnpm typecheck`, `pnpm lint:check`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm docs:check`.

  Luminous: `dart analyze lib`, `dart analyze test`, `flutter analyze`, targeted contract tests, `flutter test`, and `dart run scripts/check_doc_coverage.dart --warning-only`.

- [ ] **Step 5: Check for forbidden legacy wire shapes.**

  Run targeted `rg` searches for `statusCode`/numeric business codes/bare SSE `{ message }` payloads in contract-producing code and tests. Any remaining hit must be an explicitly documented non-wire internal field.

- [ ] **Step 6: Commit documentation/export changes separately and report any unrelated Flutter environment failures without hiding them.**
