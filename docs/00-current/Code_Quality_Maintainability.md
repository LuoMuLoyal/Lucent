# Code Quality / Maintainability

Last updated: 2026-07-03

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
