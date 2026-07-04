# Code Quality / Maintainability

Last updated: 2026-07-04

- Date parsing in `assistant-tool-date-resolver.ts` now uses `date-fns` (`isValid`,
  `differenceInCalendarDays`, `eachDayOfInterval`, `addDays`) instead of manual UTC arithmetic.
- Outbound HTTP retries are centralized in `src/common/utils/retry.utils.ts` (`withRetry` /
  `fetchWithRetry`); QQ and Apple OAuth providers share the same retry semantics.
- Public exports across `setup-app.ts`, `app.module.ts`, `adminjs.setup.ts`, `api-envelope.ts`,
  `api-errors.ts`, filters/interceptors, and `config/` now have JSDoc descriptions.
- COS and embedding defaults/limits are centralized in `src/config/constants.ts`; both
  `tencent-cos.config.ts` and `environment.validation.ts` reference the same constants.
- Repeated test literals in `environment.validation.spec.ts` (DB URLs, admin credentials) and
  hard-coded ports/codes in `cache.config.spec.ts` / `mail.service.spec.ts` are now extracted.
- `wechat-base-oauth.provider.ts` now logs network-level OAuth failures before translating them to
  `ServiceUnavailableException`.
- `common/ai` no longer imports from `modules/`: user-setting keys live in
  `src/common/constants/user-setting-keys.ts`, and `BaseAiGeneratorService` depends on the
  `LlmRuntimePort` interface defined in `src/common/ai/llm-runtime.port.ts`.
- Current-time creation is centralized through `now()` / `nowIsoString()` in
  `src/common/utils/date-time.utils.ts`; bare `new Date()` calls in non-test business code have been
  replaced.
- Silent catch blocks across auth notifications, SSE controllers, health probes, and export
  notifications now log errors before falling back, improving production observability.
- Assistant module constants are centralized in `assistant-tool.constants.ts` (vector limits,
  conversation/memory limits, tool-loop cap, mutation match weights, compact truncation length).
- Assistant module cross-module service dependencies are now consumed through `assistant-ports.ts`
  interfaces and injection tokens (`MEDICINE_REMINDER_READER`, `DAILY_RECORD_READER`,
  `DAILY_RECORD_CANDIDATE_GENERATOR`) instead of concrete class imports.
- Shared utilities expanded: `isBlank`, `isEmptyArray`, `truncate`, and `generatePrefixedId` live
  in `src/common/utils/` with unit specs.
- `api-errors.ts` helpers are now used consistently for plain `BadRequestException` throws in
  reports and daily-records services.
- `assistant-runtime.graph.ts` was split into state/router/graph files; `adminjs.setup.ts` and
  `auth.service.ts` splits remain deferred.
- `UserPayload` / `AuthRequestContext` / `TokenPair` were moved to
  `src/modules/auth/types/auth-request.ts` and re-exported for backward compatibility.
