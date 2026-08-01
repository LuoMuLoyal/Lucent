# Code Quality / Maintainability

Last updated: 2026-08-01

- Barrel files (`index.ts`) must never export `.spec.ts` files — spec exports cause `nest build` to
  compile test files into `dist/`, and runtime barrel loading triggers `describe`/`it` calls that
  fail with `ReferenceError` in non-test contexts (e.g. `pnpm export:openapi`).

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
- `common/llm` no longer imports from `modules/`: user-setting keys live in
  `src/common/constants/user-setting-keys.ts`, and `BaseLlmGeneratorService` depends on the
  `LlmRuntimePort` interface defined in `src/common/llm/llm-runtime.port.ts`.
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
  `BaseLlmGeneratorService` and `AssistantRuntimeService` both reference the same constant instead
  of hardcoding `10_000`.
- LLM calls are protected by a circuit breaker (`LlmCircuitBreakerService`) that wraps
  `withLlmRetry`. After 5 consecutive failures the breaker trips to `open`, fast-failing
  subsequent calls with HTTP 503 for 30s before entering `halfOpen` probe mode. The breaker
  is a shared singleton in `LlmCommonModule`, consumed by all 4 `BaseLlmGeneratorService`
  subclasses and `AssistantRuntimeService`.
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
  - Introduced Node.js subpath import `#generated/*` with synchronized TS/SWC/Vitest configuration.
  - All `.../generated/prisma/client` imports across `src/` and `test/` replaced with `#generated/prisma/client`.

- Shared `common/` code is now split by role instead of collecting everything under `utils/`.
  - `src/common/helpers/` holds pure helper functions and stateless shared utilities.
  - `src/common/services/` holds shared injectable services such as `LocalizedCopyService`.
  - `src/common/logger/` holds the shared Nest logging module.
- The logging foundation now uses `nest-winston` / `winston` (migrated from Pino on
  2026-07-12, see ADR-0007).
  - `requestIdMiddleware` still owns `X-Request-Id`.
  - `RequestContextService` bridges the request id into AsyncLocalStorage for
    downstream logs and exception handling.
  - `setup-app.ts` no longer emits hand-built string HTTP logs; structured
    business logs use `new Logger()` field injection consistently across all
    services.
  - HTTP access logging is handled by Nginx `access_log`; per-request
    `autoLogging` was removed (redundant with Nginx, ApiExceptionFilter, and
    Prometheus metrics).
  - `SlowRequestInterceptor` (global) warns on requests exceeding
    `SLOW_REQUEST_THRESHOLD_MS` (default 2000ms).
  - `LifecycleService` logs application start and graceful shutdown (signal, uptime).
    `main.ts` calls `enableShutdownHooks()` so SIGTERM triggers NestJS destroy hooks.
  - Production logs dual-write: Winston JSON stdout + `winston-daily-rotate-file`
    (500MB per file, 14-day retention, auto-gzip).
  - `MetricsService` (`src/common/metrics/metrics.service.ts`) collects Prometheus
    metrics via `prom-client`: default Node.js runtime metrics, HTTP request
    latency/counters, BullMQ job metrics, and LLM call/token metrics. Controlled by
    `METRICS_ENABLED` (default `true`, forced off in test). See ADR-0006.

- Unit test coverage expanded for low-coverage modules identified in the 2026-07-07 review:
  - `llm-runtime` service spec expanded from 3 to 18 tests, covering `hasRoleConfig` edge cases,
    `createChatModel` without/partial options, and `createEmbeddingModel` (null/configured/dimension).
  - `medicine-reminders` gained 3 new spec files: `mapper.service.spec.ts` (29 tests),
    `ownership.service.spec.ts` (7 tests), `reminder-deliveries.controller.spec.ts` (5 tests).
  - `account`, `notifications`, `user` were assessed as already well covered (service + controller specs).

- Audit report LUC-2026-0709 fully remediated: fuzzy-match thresholds, verification-code service
  parameters, mail-queue tuning, OAuth State TTL, and retry defaults are now environment-configurable
  with Joi validation. The `.gitattributes` file marks generated code paths.
- COS storage runtime unified: `DailyRecordImageUploadRuntime` (daily-records) and `DataExportCosRuntime`
  (data-export) replaced by a single `CosStorageRuntime` in `src/common/storage/`, provided via
  `StorageModule`. The `files` module no longer reverse-depends on `daily-records/config/`.
- Today-suggestion test coverage expanded: 5 new spec files (+65 test cases) for `MedicationCollectorService`,
  `ProfileCollectorService`, `RecordCollectorService`, `BaselineService`, and `SuggestionService`
  (the orchestrator). Total test count: 119 suites, 839 tests.

- 2026-07-11 测试覆盖审查：为 6 个无测试的纯函数文件新增 spec，并为 environment.service.spec.ts 补全边界用例：
  - `assistant/tools/date-resolver.spec.ts`（54 tests）：ISO/中文/斜杠/相对日期解析、范围截断、报告范围提取等
  - `assistant/tools/presenters.spec.ts`（56 tests）：read envelope、coverage、confidence、preview fields、locale helpers、summary descriptions
  - `assistant/tools/vector-cursor.spec.ts`（14 tests）：cursor 编解码、query hash、page 构建
  - `assistant/tools/read-helpers.spec.ts`（12 tests）：reminder frequency 描述、sleep quality 映射
  - `medicines/utils/helpers.spec.ts`（33 tests）：toStringList、uniqueNonEmptyStrings、truncateText、detectMatchedBy、toPagination
  - `auth/controllers/auth-response.helper.spec.ts`（6 tests）：auth response 序列化、null 字段处理
  - `environment.service.spec.ts` 边界补全（2→9 tests）：仅 lat/lon 降级、热带/高纬度/南北中纬度区域选择
  - 测试总量：197 suites / 1743 tests（+6 suites / +176 tests）

- 2026-07-14 测试缺口补充：为 12 个无测试的源文件新增 spec，共 +87 tests：
  - 配置文件测试（3 个 spec，+21 tests）：`oauth.config.spec.ts`（6 tests）、`mail.config.spec.ts`（4 tests）、`tencent-cos.config.spec.ts`（5 tests）——覆盖 env 读取、默认值、自定义值场景
  - 装饰器测试（4 个 spec，+15 tests）：`current-user.decorator.spec.ts`（6 tests，重构导出 `currentUserFactory`）、`public.decorator.spec.ts`（3 tests）、`skip-api-envelope.decorator.spec.ts`（3 tests）、`require-elevation.decorator.spec.ts`（3 tests）——覆盖 metadata 设置、字段提取、空值场景
  - Zod schema 测试（4 个 spec，+33 tests）：`daily-record-candidates.schema.spec.ts`（23 tests，导出 `sleepPayloadSchema`）、`report-summary.schema.spec.ts`（11 tests）、`analysis.schema.spec.ts`（9 tests）、`explanation.schema.spec.ts`（6 tests）——覆盖验证约束、边界值、枚举、长度限制
  - `setup-app.spec.ts`（8 tests）：导出 `formatValidationErrors` 和 `collectValidationMessages`，覆盖递归子错误、嵌套约束、空数组场景
  - 源码改动：`current-user.decorator.ts` 导出 `currentUserFactory`；`setup-app.ts` 导出两个格式化函数；`daily-record-candidates.schema.ts` 导出 `sleepPayloadSchema`

- 2026-07-14 测试缺口补充（第三轮）：为 6 个无测试的源文件新增 spec，共 +100 tests：
  - `report-pdf.theme.spec.ts`（28 tests）：覆盖 `kindLabel`/`statusPalette`/`metricLabel`/`statusLabel` 四个纯函数，中英文 × 各状态/类型组合
  - `message.schema.spec.ts`（11 tests）：覆盖 `assistantMessageRoleSchema` 枚举、`assistantMessageSchema` 长度边界/空值/trim
  - `reference.spec.ts`（14 tests）：覆盖 `getStaticEnvironmentSnapshot` 区域选择逻辑（default/china_temperate/tropical/high_latitude/northern/southern）、边界值、深拷贝
  - `auth.decorators.spec.ts`（23 tests）：覆盖 `IsStrongPassword`/`IsVerificationCode`/`IsEmailAddress` 装饰器及密码常量/正则
  - `tool-definitions.spec.ts`（7 tests）：覆盖 `buildToolDefinitions` 空数组/单个/全量/顺序/描述/schema
  - `user-settings/constants.spec.ts`（17 tests）：覆盖 `USER_SETTING_KEYS`/`ASSISTANT_CONTEXT_SETTING_KEYS`/默认值/`listDefaultBooleanUserSettings`

- 2026-07-20 审计日志 + 推送通知投递链路：
  - `AuditLogService` 采用 fire-and-forget 模式（`logFireAndForget()`），审计写入失败不阻塞
    请求（warn 日志 + 错误吞咽），确保用户操作不受审计基础设施影响
  - `PushDeliveryService` 优雅降级：未配置 FCM/APNs 时为 no-op stub（仅 log.debug），
    替换 inner block 即可接入真实 SDK，无需修改调用方
  - `ReminderSchedulerService` 和 `EscalationService` 均集成双通道投递（站内 + 推送），
    推送失败不影响站内通知已创建的记录
- `AuthNotificationService` 通知类型语义已修正：`notifyOAuthLogin` → `oauth_login`，
  `notifyIdentityLinked` → `identity_linked`（原均误用 `password_changed`）
- `DataRetentionService`（`@Cron('0 3 * * *')`）每日清理过期会话、已读通知（30天）、
  过期反馈抑制记录，各清理步骤独立容错，单步失败不阻断其他清理
- `ThrottlerConfigService` 条件性启用 Redis 限流存储：`REDIS_URL` 存在时使用 ioredis
  INCR+PEXPIRE，否则回退内存；动态 import 避免传递依赖问题
- B5 nonDeleted 迁移：6 个源文件从手动 `deletedAt: null` 迁移到 `prisma.nonDeleted` API，
  事务内代码保留手动写法（Prisma 扩展在事务客户端不可用）
- `CronJobsService.onModuleInit` 中 `registerSchedulers` 调用包裹 try-catch：Redis 已配置但
  暂时不可用时 `upsertJobScheduler` 抛异常不再阻止应用启动，error 日志记录后下次重启自动重试；
  拆分队列时同步调用 `removeJobScheduler` 清理旧队列中的遗留调度器，避免历史 scheduler 继续生成
  已迁移 job 导致 `Unknown cron job name` 警告。

- 2026-07-29 工具链质量改进：
  - ESLint 从 `eslint-plugin-prettier` 迁移到 `eslint-config-prettier` only，格式检查由独立的
    `pnpm format:check` 命令和 pre-commit `lint-staged` 负责。
  - `format:check` / `format` 覆盖范围扩展到 `scripts/**/*.ts`、`deploy/**/*.ts`、根目录
    `*.{ts,json,yml,yaml,md}`，新增 `.prettierignore` 排除 `pnpm-lock.yaml` 等生成文件。
  - `pre-push` hook 精简为仅 `pnpm typecheck`（lint 已由 pre-commit `lint-staged` 覆盖暂存文件）。
  - `.swcrc` target 从 `es2022` 对齐到 `es2023`（与 `tsconfig.json` 一致）。
  - `tsconfig.json` 显式指定 `tsBuildInfoFile` 路径，稳定增量缓存位置。
  - `fix-generated-prisma-internal.ts` 用 `@swc/core` `transformFile` 替代 `typescript.transpileModule`。
  - Vitest coverage 阈值从 50/60/60/60 提升至 68/78/80/79（实测 73/83/85/84）。
  - `vitest.config.ts` 显式声明 `pool: 'forks'`。

- 2026-07-29 架构精炼 Phase 2 — Reader Port 补全（ADR-0009）：
  - 新增 `MedicineReminderReaderPort` + `MedicineReminderFact`，`MedicineRemindersModule` 导出
    reader port，跨模块消费者不再直接注入 `PrismaService` 查询 `UserMedicineReminder`。
  - `today-analysis/context.service.ts` 中 `prisma.userMedicineReminder.findMany` 替换为
    `reminderReader.listActiveFacts(userId)`，移除内联 `_reminderSelect` / `ReminderShape`。
  - `reports/dashboard/context.service.ts` 中 `prisma.userSetting.findFirst` 替换为
    `userSettingsService.getSettings(userId)`，移除 `PrismaService` 依赖。
  - `today-suggestion/collectors/record.service.ts` 中 `prisma.userSetting.findUnique` 替换为
    `userSettingsService.getSettings(userId)`，移除 `PrismaService` 依赖。

- 2026-08-01 测试缺口修复（按 `plans/2026-08-01-test-gap-fix.md`）：
  - `pdf.service.spec.ts` 两个多页 PDF 渲染用例超时 30s → 120s，消除 CI flaky（实测用例 2.9s）。
  - medicines risk-check 子系统 8 个源文件覆盖率从 0–14% 提升至 ≥90%（lines，prompt 100%），
    新增 9 个 spec + `test/e2e/medicines/risk-check.e2e-spec.ts`（5 用例，401/首查空/static 持久化）。
  - P2 中等覆盖率文件全部 ≥80%：today-analysis/today-suggestion controller、assistant runtime.service、
    auth.service、oauth.controller、app.controller、copy.service（100%）。
  - `classify.ts` 0% 为缓存误报已确认排除：清 `node_modules/.vite` 后单文件实测 ≥90%。
  - 全量基线：`pnpm test:ci` 274 文件 2769 用例零失败；`pnpm test:coverage` 整体 lines 90.25%
    （阈值 lines 80 / functions 78 / statements 79 / branches 68）。
