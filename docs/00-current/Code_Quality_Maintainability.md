# Code Quality / Maintainability

Last updated: 2026-07-09

- auth 模块三处静默 catch 补充 logger.warn：`auth.service.ts` refresh、`auth-oauth-state.service.ts`
  normalizeCallbackUri、`credential-auth.service.ts` \_notifyPasswordChanged，保留生产环境可观测性。
- `adminjs.setup.ts` 认证/路由构建逻辑提取到 `services/admin-auth-router.service.ts`，
  主文件从 106 行精简至约 77 行。
- Date parsing in `assistant-tool-date-resolver.ts` now uses `date-fns` (`isValid`,
  `differenceInCalendarDays`, `eachDayOfInterval`, `addDays`) instead of manual UTC arithmetic.
- Outbound HTTP retries are centralized in `src/common/helpers/retry.utils.ts` (`withRetry` /
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
  `src/common/helpers/date-time.utils.ts`; bare `new Date()` calls in non-test business code have been
  replaced.
- Silent catch blocks across auth notifications, SSE controllers, health probes, and export
  notifications now log errors before falling back, improving production observability.
- Assistant module constants are centralized in `assistant-tool.constants.ts` (vector limits,
  conversation/memory limits, tool-loop cap, mutation match weights, compact truncation length).
- Assistant module cross-module service dependencies are now consumed through `assistant-ports.ts`
  interfaces and injection tokens (`MEDICINE_REMINDER_READER`, `DAILY_RECORD_READER`,
  `DAILY_RECORD_CANDIDATE_GENERATOR`) instead of concrete class imports.
- Shared helpers expanded: `isBlank`, `isEmptyArray`, `truncate`, and `generatePrefixedId` live in
  `src/common/helpers/` with unit specs.
- `api-errors.ts` helpers are now used consistently for plain `BadRequestException` throws in
  reports and daily-records services.
- AI model invocation timeout is centralized as `AI_MODEL_TIMEOUT_MS` in `src/config/constants.ts`;
  `BaseAiGeneratorService` and `AssistantRuntimeService` both reference the same constant instead
  of hardcoding `10_000`.
- Error-info extraction is centralized in `src/common/helpers/error-info.utils.ts`
  (`extractErrorInfo`); 13 catch blocks across 11 files now share the same message/stack extraction
  pattern instead of repeating `error instanceof Error ? error.message : String(error)`.
- Key optional string fields in daily-records, medicine-dose-logs, and medicine-reminders DTOs now
  use `@IsNotEmpty()` alongside `@IsString()` to reject empty strings that would otherwise pass
  validation. Fields that explicitly support empty-string clearing (e.g. `UpdateAccountDto.nickname`)
  are intentionally left without `@IsNotEmpty()`.
- `assistant-runtime.graph.ts` was split into state/router/graph files; `adminjs.setup.ts` was
  split into types/constants/services files; `auth.service.ts` was split into account, OAuth
  facade, and notification sub-services.
- `UserPayload` / `AuthRequestContext` / `TokenPair` were moved to
  `src/modules/auth/types/auth-request.ts` and re-exported for backward compatibility.

- Module subdirectory whitelist is now enforced and aligned with actual code:
  - `prompts/`, `schemas/`, and `strategies/` added to `AGENTS.md` Standard whitelist.
  - Module-level `config/` restricted to runtime configuration objects/classes only.
  - `medicines/sources/` renamed to `medicines/adapters/` (matches existing `adapters/` whitelist).
  - `assistant/tools/services/` flattened into `assistant/tools/`.
  - `data-export/config/report-pdf.constants.ts` moved to `data-export/constants/`;
    `report-pdf.theme.ts` moved to `data-export/utils/`.
  - `user-settings/config/user-settings.constants.ts` moved to `user-settings/constants/`.
  - `architecture.md` directory example updated to match the whitelist.

- Prisma-generated client moved out of `src/` to root-level `generated/prisma`.
  - Introduced Node.js subpath import `#generated/*` with synchronized TS/SWC/Jest configuration.
  - All `.../generated/prisma/client` imports across `src/` and `test/` replaced with `#generated/prisma/client`.

- Shared `common/` code is now split by role instead of collecting everything under `utils/`.
  - `src/common/helpers/` holds pure helper functions and stateless shared utilities.
  - `src/common/services/` holds shared injectable services such as `LocalizedCopyService`.
  - `src/common/logger/` holds the shared Nest logging module.
- The logging foundation now uses `nestjs-pino` / `pino-http` instead of
  Winston.
  - `requestIdMiddleware` still owns `X-Request-Id`.
  - `RequestContextService` bridges the request id into AsyncLocalStorage for
    downstream logs and exception handling.
  - `setup-app.ts` no longer emits hand-built string HTTP logs; structured
    request/response logs and global exception logs share the same Pino
    baseline.

- Unit test coverage expanded for low-coverage modules identified in the 2026-07-07 review:
  - `llm-runtime` service spec expanded from 3 to 18 tests, covering `hasRoleConfig` edge cases,
    `createChatModel` without/partial options, and `createEmbeddingModel` (null/configured/dimension).
  - `medicine-reminders` gained 3 new spec files: `mapper.service.spec.ts` (29 tests),
    `ownership.service.spec.ts` (7 tests), `reminder-deliveries.controller.spec.ts` (5 tests).
  - `account`, `notifications`, `user` were assessed as already well covered (service + controller specs).

- Audit report LUC-2026-0709 fully remediated: fuzzy-match thresholds, verification-code service
  parameters, mail-queue tuning, OAuth State TTL, and retry defaults are now environment-configurable
  with Joi validation. The `.gitattributes` file marks generated code paths.
