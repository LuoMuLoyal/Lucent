---
status: active
owner: backend
quadrant: reference
updated: 2026-08-16
---

# Code Quality / Maintainability

Last updated: 2026-08-16

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
- Date-in-timezone formatting is centralized as `formatDateOnlyInTimezone()` /
  `DEFAULT_USER_TIMEZONE` (Asia/Shanghai) in `src/common/helpers/format/date-time.utils.ts`;
  suggestion-cache invalidation resolves "today" in the user's profile timezone instead of the
  server-local timezone.
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
  - `setup-app.ts` no longer emits hand-built string HTTP logs; structured
    business logs use `new Logger()` field injection consistently across all
    services.
  - HTTP access logging is handled by Nginx `access_log`; per-request
    `autoLogging` was removed (redundant with Nginx, ApiExceptionFilter, and
    Prometheus metrics).
  - All logs inside an active OTel span carry top-level `trace_id` / `span_id`
    (from `src/common/logger/trace-context.utils.ts` `getActiveTraceIds()`, using
    the active span in the OTel context), linking each log line to the same
    Jaeger trace. The former `requestId` mechanism (AsyncLocalStorage,
    `X-Request-Id`, `requestIdFormat`) has been retired entirely — see ADR-0010.
  - `src/tracing.ts` (first import in `main.ts`) initializes the OpenTelemetry
    SDK with automatic instrumentation (HTTP/DB/Redis), gated by
    `OTEL_ENABLED=true`; default off, so tests and existing flows are unaffected.
  - For local integration: `docker compose -f docker-compose.dev.yml up -d jaeger`
    starts Jaeger all-in-one; traces are exported over OTLP HTTP to port 4318 and
    viewable in the Jaeger UI at `http://127.0.0.1:16686`.
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
  - `PushDeliveryService` 通过 JPush alias 投递并优雅降级：未配置 JPush 凭证时仅
    `log.debug` 跳过，provider 失败记录 warn 且不阻塞站内通知
  - `ReminderSchedulerService` 和 `EscalationService` 均集成双通道投递（站内 + 推送），
    推送失败不影响站内通知已创建的记录
    （2026-08-16 起 `ReminderSchedulerService` 升级为三通道审计——in_app 始终写入、
    local 由客户端回执幂等回写、push 仅在本地能力 unconfirmed/unavailable 时后台回退，
    见 ADR-0013；`EscalationService` 仍为站内 + 推送双通道）
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

- 2026-08-06 增量审查修复：
  - `streamModelResponse` 的 `onText` catch 收紧为仅传输层错误（`ECONNRESET`、`EPIPE`、
    `ERR_STREAM_PREMATURE_CLOSE`、`AbortError` 等），编程错误和业务逻辑错误继续抛出，
    避免回调内部 Bug 被静默掩盖。
  - `extractMessageText` 的 `'text' in part` 改为 `Object.prototype.hasOwnProperty.call`，
    避免原型链属性误判。
  - `nodes.ts` 移除 `response instanceof AIMessage` 冗余检查及不可达的 `no_match` 分支。
  - `respond.ts` 缓存 key 构造增加 `userMessage` 非空防御，避免缓存污染。
  - `setup-app.ts` 中 `resolveScalarStandaloneUrl` catch 块新增 `Logger.warn`，
    便于 serverless / 只读文件系统环境排查 Scalar 版本解析失败。

- 2026-08-05 全仓库审查修复（按 `plans/Lucent-review-2026-08-05.md`）：
  - `isQueueConnectionError` 正则匹配收紧：移除 `/Connection/i`、`/Redis/i`、`/socket/i`、
    `/timeout/i` 等宽泛模式，改为优先通过 `error.code` 精确匹配 errno 代码（`ECONNREFUSED` 等），
    仅保留窄化的消息模式 fallback，避免业务错误被误判为连接错误而静默走 fallback。
  - `respondCache.set` 新增 `logger.debug` 调用，记录 key 前缀和 TTL，提供缓存写入审计追踪。
  - Redis 默认端口 `6379` 提取为 `REDIS_DEFAULT_PORT` 命名常量。
  - 重复的短哈希逻辑提取为 `src/common/helpers/infra/hash.utils.ts` 的 `makeShortHash` 函数，
    `respond.ts` 和 `tool.service.ts` 共享同一实现。
  - `enqueueOrFallback` 新增可选 `logger` 参数，调用方传入实例 Logger 替代静态 Logger。

- 2026-08-04 审查修复（按 `plans/Lucent-review-2026-08-04.md`）：
  - `parseRedisUrl` 增加输入校验与上下文错误信息，IPv6 地址去除 URL 方括号，避免 `REDIS_URL`
    配置错误导致启动崩溃或 IPv6 Redis 无法连接。
  - `enqueueOrFallback` 仅捕获 Redis/网络相关异常后走同步 fallback，`TypeError` /
    `ReferenceError` / `SyntaxError` 等编程错误继续抛出，防止真实 bug 被静默吞咽。
  - 助手 runtime 中重复的内容提取逻辑收敛到 `message-text.utils.ts` 的 `extractMessageText`，
    供 `model-stream.ts`、`nodes.ts`、`respond.ts` 复用。
  - `streamModelResponse` 的 `onText` 回调抛错时被隔离并记录日志，流式聚合继续执行，避免
    SSE 传输层异常直接引发 Assistant 请求 500。
  - Reminder 去重迁移 SQL 由 O(n²) 自连接改为 `ctid + ROW_NUMBER` CTE，降低大表迁移锁表风险。
  - `setup-app.ts` 中 Scalar bundle URL 版本号解析从模块加载时移到 `setupApp` 运行时，并优先读取
    `SCALAR_API_REFERENCE_VERSION` 环境变量，支持 serverless / 只读文件系统部署。

- 2026-08-01 测试缺口修复（按 `plans/2026-08-01-test-gap-fix.md`）：
  - `pdf.service.spec.ts` 两个多页 PDF 渲染用例超时 30s → 120s，消除 CI flaky（实测用例 2.9s）。
  - medicines risk-check 子系统 8 个源文件覆盖率从 0–14% 提升至 ≥90%（lines，prompt 100%），
    新增 9 个 spec + `test/e2e/medicines/risk-check.e2e-spec.ts`（5 用例，401/首查空/static 持久化）。
  - P2 中等覆盖率文件全部 ≥80%：today-analysis/today-suggestion controller、assistant runtime.service、
    auth.service、oauth.controller、app.controller、copy.service（100%）。
  - `classify.ts` 0% 为缓存误报已确认排除：清 `node_modules/.vite` 后单文件实测 ≥90%。
  - 全量基线：`pnpm test:ci` 274 文件 2769 用例零失败；`pnpm test:coverage` 整体 lines 90.25%
    （阈值 lines 80 / functions 78 / statements 79 / branches 68）。

- 2026-08-16 提醒投递三通道落库（F-4，ADR-0013）：
  - `UserReminderDelivery` 唯一约束 `(userId, reminderId, scheduledFor)` →
    `(userId, reminderId, scheduledFor, channel)`，同一提醒事件三通道各一行审计。
  - 调度器三通道流程：in_app 始终写入 → local 行已存在则跳过 push → 本地能力
    （`reminder:local-capability:{userId}` 缓存，TTL 14 天）active/disabled 不发 push、
    unconfirmed/unavailable 才 JPush 回退 → push 结果按 delivered/failed 落行。
  - `PushDeliveryService.sendToUser` 返回 `{ sent, errorMessage? }`（永不 reject，
    未配置返回 `{ sent: false }`），调度器据此落 push 审计行。
  - 新增投递写入接口：`POST /api/v1/user/reminder-deliveries/receipts`（本地回执，
    墙钟时间按 profile 时区换算 UTC 截断分钟，幂等 upsert）与
    `PUT /api/v1/user/reminder-deliveries/local-capability`（能力上报）。
  - 时区换算抽为 `services/delivery-moment.ts`（`DEFAULT_TIMEZONE`、
    `formatLocalDate`、`wallClockToScheduledFor`），scheduler 与回执服务共用；
    新增 `delivery-moment.spec.ts`、`delivery-receipts.service.spec.ts`，扩展
    scheduler / push-delivery / controller spec 与 e2e 覆盖。

- 2026-08-16 提醒文案 i18n（F-8）：
  - 调度器提醒标题/正文从硬编码中文改为经 `I18nService` 按 `UserProfile.locale`
    本地化（fallback `zh-CN`，`resolveLocale` 归一化），in-app 与 JPush 两处复用
    同一翻译结果；`findDueReminders` select 复用既有 user→profile join 补 `locale`。
  - 新增 i18n key：`medicine-reminders.reminder_fallback_label` 与
    `medicine-reminders.reminder_due_content`（`{label}` 插值，zh-CN / en 各一份）。

- 2026-08-16 提醒组整组 upsert（F-6）：
  - `MedicineReminderRepositoryPort` 新增 `transaction<T>(fn)` 端口（实现委托 `prisma.$transaction`），
    事务边界下沉到 repository，服务层不直接依赖 `PrismaService`。
  - 组级字段复用 `mapper.service` 私有 helper（`parseOptionalDate` / `assertValidDateWindow` /
    `normalizeDaysOfWeek` / `normalizeNullableText`），新增 `toGroupUpsertData` / `toGroupUpdateData`
    逐槽生成 Prisma 输入，避免与 create/update 路径重复实现。
  - 整组 upsert 在单事务内完成 update/create/`updateMany` 软删，提交后只发一次 `reminder.changed`
    事件，消除逐槽提交在弱网下的半保存窗口；空 slots 服务层防御性 400（DTO 已 `@ArrayMinSize(1)`）。
