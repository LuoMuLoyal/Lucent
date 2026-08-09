---
status: active
owner: backend
quadrant: explanation
updated: 2026-08-09
---

# Lucent Architecture

## Module Dependency Graph

```mermaid
graph TD
    subgraph "Public APIs"
        auth["auth<br>/auth/*"]
        account["account<br>/account/*"]
        medicines["medicines<br>/medicines/*"]
        environment["environment<br>/environment"]
        support["support-resources<br>/public/*"]
    end

    subgraph "User Resources (RouterModule /user/*)"
        assistant["assistant"]
        auditLog["audit-log<br>(@Global, audit trail)"]
        daily["daily-records"]
        dataExport["data-export"]
        dataRetention["data-retention<br>(@Cron cleanup)"]
        files["files"]
        doseLogs["medicine-dose-logs"]
        healthEvents["health-events"]
        reminders["medicine-reminders<br>(+ scheduler @Cron)"]
        notifications["notifications<br>(+ push delivery)"]
        reports["reports"]
        today["today-analysis"]
        todaySuggestion["today-suggestion<br>(75 files, 44 providers)<br>第二大 feature module"]
        healthCtx["user-health-context"]
        settings["user-settings"]
    end

    subgraph "Internal Services"
        llm["llm-runtime<br>(LLM model factory)<br>src/llm-runtime/"]
        user["user<br>(data layer)"]
        security["security-pin<br>(PIN + elevation tokens)"]
        testing["testing-support<br>(test only)"]
    end

    subgraph "Infrastructure"
        prisma["PrismaService"]
        mail["MailService"]
        i18n["I18nService"]
        jwt["JwtService"]
    end

    %% Public API dependencies
    auth --> user
    auth --> notifications
    auth --> jwt
    account --> auth
    account --> auditLog
    account --> security

    %% User resource dependencies
    assistant --> llm
    assistant --> daily
    assistant --> reminders
    assistant --> healthCtx
    assistant --> settings
    daily --> llm
    daily --> todaySuggestion
    doseLogs --> todaySuggestion
    reports --> llm
    reports --> assistant
    today --> llm
    today --> assistant
    today --> notifications
    todaySuggestion --> llm
    todaySuggestion --> daily
    todaySuggestion --> doseLogs
    todaySuggestion --> reminders
    todaySuggestion --> healthCtx
    todaySuggestion --> settings
    todaySuggestion --> notifications
    dataExport --> reports
    dataExport --> notifications
    dataExport --> security
    medicines --> llm
    files --> daily

    %% Infrastructure
    auth --> prisma
    user --> prisma
    security --> user
    security --> jwt
    daily --> prisma
    notifications --> prisma
    reports --> prisma
    today --> prisma
    todaySuggestion --> prisma
    healthCtx --> prisma
```

## Cross-Module Data Access (Reader Ports)

Cross-module data access is governed by [ADR-0009](adr/0009-cross-module-data-access.md).
The core principle: owning module defines the read contract, consumers depend on the
abstract port — never on Prisma query DSL directly.

### Provider-side Reader Ports

These abstract classes are co-located with their concrete repository implementation,
bound via `useExisting` (single instance), and exported through the module root barrel
when external consumers exist.

| Port                         | Owning Module      | File                                      | Exported | Consumers                                                                   |
| ---------------------------- | ------------------ | ----------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `DailyRecordReaderPort`      | daily-records      | `repositories/daily-record.repository.ts` | Yes      | today-analysis, today-suggestion (collectors + baseline), reports/dashboard |
| `MedicineDoseLogReaderPort`  | medicine-dose-logs | `repositories/dose-log.repository.ts`     | Yes      | today-analysis, today-suggestion (collectors), reports/dashboard            |
| `MedicineReminderReaderPort` | medicine-reminders | `repositories/reminder.repository.ts`     | Yes      | today-analysis                                                              |

Each reader returns **fact DTOs** (plain data shapes), not Prisma `WhereInput` or model
objects. Sorting and soft-delete filtering (`nonDeleted`) are baked into the reader
implementation, so consumers never duplicate these concerns.

### Assistant Consumer-side Ports

The assistant module uses a consumer-defined port pattern (`assistant/types/ports.ts`)
— the consumer declares the interface it needs, the providing module implements it.
This is the opposite of provider-side reader ports but is preserved as the best
boundary example per ADR-0009.

| Interface                        | Symbol Token                       | Provider Module    | Purpose                       |
| -------------------------------- | ---------------------------------- | ------------------ | ----------------------------- |
| `IMedicineReminderReader`        | `MEDICINE_REMINDER_READER`         | medicine-reminders | List active reminders         |
| `IDailyRecordReader`             | `DAILY_RECORD_READER`              | daily-records      | Paginated daily record lookup |
| `IDailyRecordCandidateGenerator` | `DAILY_RECORD_CANDIDATE_GENERATOR` | daily-records      | LLM candidate generation      |

### Exemptions

Per ADR-0009, **read-model modules** (today-analysis, today-suggestion, reports) are
**exempt** from the reader-port requirement — their aggregation queries are varied and
forcing them through narrow ports would be over-engineering. These modules may inject
`PrismaService` directly for cross-module reads, but should encapsulate queries in
internal `repositories/` for cleanliness.

## AI Pipeline Architecture

All AI analysis modules follow a three-layer pattern:

```mermaid
graph LR
    subgraph "Layer 1: Context"
        CC["Context Service<br>build(userId, dto) → context"]
    end

    subgraph "Layer 2: Generation"
        GC["Copy Service<br>(i18n prompt copy)"]
        GEN["Generator Service<br>extends BaseLlmGeneratorService"]
        CC --> GEN
        GC --> GEN
    end

    subgraph "Layer 3: Policy & Persistence"
        POL["Safety Policy<br>(forbidden patterns)"]
        PERSIST["persistSummary()"]
        GEN --> POL
        POL --> PERSIST
    end
```

### Implementations

- ReportsAiSummary
  - Context: ReportsAiSummaryContextService
  - Generator: ReportsAiSummaryGeneratorService
  - Model Role: `analysis`
- TodayAnalysis
  - Context: TodayAnalysisContextService
  - Generator: TodayAnalysisGeneratorService
  - Model Role: `analysis`
- DailyRecordCandidates
  - Context: (inline in service)
  - Generator: DailyRecordCandidatesGeneratorService
  - Model Role: `language`
- Assistant
  - Context: (chat-based, different architecture)
  - Generator: —
  - Model Role: `chat`

### Assistant SSE Streaming Boundary

- `POST /api/v1/user/assistant/messages/stream` keeps LangGraph
  `graph.invoke()` as the tool-loop and checkpoint orchestrator.
- The Assistant `agent` and `respond` nodes call `model.stream()`, forward
  text deltas through the SSE callback, and retain an aggregated `AIMessage`
  for tool routing and persistence.
- `POST /api/v1/user/today-analysis/generate/stream` and
  `POST /api/v1/user/reports/summary/generate/stream` use the shared
  `BaseLlmGeneratorService.generateStream()` structured-output path.
- All three endpoints write incremental events before their terminal
  `result` and `done` events; cache/pre-generated Assistant replies use a
  server-side chunking fallback.

## Directory Structure Convention

See `AGENTS.md` → Module Subdirectory Whitelist for the complete governance rules.

Root-level `src/` infrastructure directories stay separate from `common/` shared code. In
particular, `mail/`, `prisma/`, `config/`, and `i18n/` remain root-level runtime boundaries, while
`common/` is internally split by role:

- `common/helpers/` — pure helper functions, split by domain:
  `prisma/` (query helpers, ownership), `errors/` (API error factories, error info/payload),
  `format/` (string/number/json/date/search/localized-copy), `infra/` (array/crypto/hash/ip/pagination/queue/retry)
- `common/api/` — API envelope + SSE infrastructure; SSE files live in `common/api/sse/`
- `common/services/` — shared injectable services
- `common/logger/` — shared Nest logging module
- `common/llm/`, `common/filters/`, `common/interceptors/`, `common/middleware/`,
  `common/constants/`, `common/validators/`, `common/queue/`, `common/metrics/`,
  `common/events/`, `common/storage/`, `common/types/`, `common/redis/` — capability-specific shared code

Root-level `src/config/` is split by role:

- `config/services/` — 8 `registerAs()` config factories (cache, jwt, jpush, llm, mail, oauth, tencent-cos, throttler)
- `config/env/` — environment validation, env-file paths, `EnvKey` and `ConfigKey` enums
- `config/app.config.ts` — root app config; `config/constants.ts` — shared config constants

```
src/modules/{module}/
├── dto/               # Data Transfer Objects
├── services/          # All business-logic services
│   ├── {module}.service.ts
│   ├── {module}-mapper.service.ts  # Mapper convention
│   └── ownership.service.ts        # Ownership verification convention
├── guards/            # NestJS Guards (only .guard.ts, CanActivate)
├── types/             # Module-level TypeScript types
├── constants/         # Module-level constants
├── prompts/           # AI prompt copy and templates
├── schemas/           # AI output schemas and structured-response validators
├── config/            # Module-level runtime configuration (objects/classes only)
├── {module}.controller.ts
├── {module}.module.ts
└── index.ts           # Module root barrel (explicit exports, never export *)
```

## API Route Architecture

Routes are configured via `RouterModule` in `AppModule`. Controllers declare bare resource paths;
the prefix is centralized.

- `/auth/*`
  - Modules: auth
  - Via: Controller `@Controller('auth')`
- `/account/*`
  - Modules: account
  - Via: Controller `@Controller('account')`
- `/medicines/*`
  - Modules: medicines
  - Via: Controller `@Controller('medicines')`
- `/environment`
  - Modules: environment
  - Via: Controller `@Controller('environment')`
- `/public/*`
  - Modules: support-resources
  - Via: Controller `@Controller('public')`
- `/testing/*`
  - Modules: testing-support
  - Via: Controller `@Controller('testing/fullstack-e2e')`
- `/user/*`
  - Modules: assistant, daily-records, data-export, files, health-context, health-events,
    medicine-dose-logs, medicine-reminders, notifications, reports, settings, today-analysis,
    today-suggestion
  - Via: `RouterModule.register()`

## Error Handling

All error responses use `api-errors.ts` helpers (`notFound`, `badRequest`, `unauthorized`,
`forbidden`, `conflict`) with i18n keys. The global envelope is `{ code: ResultCode, message:
string, data?: T }`. `ApiExceptionFilter` is now resolved from Nest DI instead
of being `new`-ed in bootstrap code so it can emit structured Winston logs
with `trace_id`, `span_id`, method, path, status, and stack metadata.

## Logging Foundation

- `src/common/logger/logger.module.ts` registers the app-wide `nest-winston`
  logger. Development console uses a colorized `printf` format (timestamp,
  level, context, `[trace=xxxxxxxx]`, message, metadata, stack); production/test
  uses single-line JSON with `timestamp`. Set `LOG_FORMAT=pretty|json` to override.
- `src/common/logger/trace-context.utils.ts` (`getActiveTraceIds()`) reads the
  active OpenTelemetry span from the OTel context; the `otelTraceFormat` in
  `logger.config.ts` injects top-level `trace_id` / `span_id` into every log
  emitted inside an active span (no span → no injection). The former requestId
  mechanism (request middleware, `RequestContextService`, AsyncLocalStorage) has
  been retired — see ADR-0010.
- `src/tracing.ts` (first import in `main.ts`) initializes the OTel SDK with
  automatic instrumentation (HTTP/DB/Redis), gated by `OTEL_ENABLED=true`;
  `setup-app.ts` writes a `traceresponse` response header
  (`00-{traceId}-{spanId}-01`) via a Fastify `onSend` hook so App clients can
  read the trace id back.
- `setup-app.ts` no longer hand-builds string HTTP logs; request/response
  logging is handled by Winston with route-level noise suppression for
  health/docs endpoints. Each log line includes response time (e.g.
  `completed 200 in 42ms`).
- `SlowRequestInterceptor` (`src/common/interceptors/slow-request.interceptor.ts`)
  is a global interceptor that warns when a request exceeds
  `SLOW_REQUEST_THRESHOLD_MS` (default 2000ms). Use `@SkipSlowRequestLog()` to
  opt out per-handler.
- `LifecycleService` (`src/common/logger/lifecycle.service.ts`) logs structured
  startup and shutdown events. `main.ts` calls `app.enableShutdownHooks()` so
  SIGTERM/SIGINT triggers NestJS lifecycle hooks (Prisma disconnect, etc.).

## Metrics Foundation

- `src/common/metrics/metrics.module.ts` is a Global module that provides
  `MetricsService` — the centralised Prometheus metrics registry.
- `MetricsService` (`src/common/metrics/metrics.service.ts`) collects:
  - Default Node.js runtime metrics via `prom-client` `collectDefaultMetrics`
    (heap, rss, event loop lag, GC stats, active handles)
  - HTTP request latency histogram and counter
    (`http_request_duration_seconds`, `http_requests_total`)
  - BullMQ job counter and gauges
    (`bullmq_jobs_total`, `bullmq_active_jobs`, `bullmq_waiting_jobs`)
  - LLM call duration histogram and token counter
    (`llm_call_duration_seconds`, `llm_tokens_used_total`)
- The `/metrics` endpoint is served as a raw Express route in `setupApp`,
  not a NestJS controller, so it bypasses the interceptor/filter stack.
- The metrics middleware (`src/common/metrics/metrics.middleware.ts`) uses
  `res.on('finish')` to capture the final HTTP status code. Route paths are
  normalised (UUIDs and numeric IDs → `:id`) to prevent label cardinality
  explosion.
- `METRICS_ENABLED` env var controls activation (default `true`, forced off in
  test environment). See ADR-0006 for the full observability strategy.

## Queue Topology

All BullMQ queues share a single Redis connection managed by `BullmqQueueFactory`
(`src/common/queue/queue.factory.ts`). Each queue has an `enqueue` endpoint
(POST `/async`) and a `getStatus` polling endpoint (GET `/status/:jobId`).
`BaseAsyncQueueService` (`src/common/queue/base-async-queue.service.ts`) provides
the shared enqueue/poll/cache lifecycle; subclasses implement `executeJob`.

```mermaid
graph TD
    subgraph "Queue Infrastructure"
        factory["BullmqQueueFactory<br>src/common/queue/queue.factory.ts"]
        base["BaseAsyncQueueService<br>src/common/queue/base-async-queue.service.ts"]
        factory --> base
    end

    subgraph "Queue Services (7 + 1 mail)"
        meal["meal-analysis<br>(daily-records)"]
        export["data-export<br>(data-export)"]
        recog["medicine-recognition<br>(medicines)"]
        report["report-summary<br>(reports/ai-summary)"]
        clinic["clinic-pdf<br>(reports/clinic-summary)"]
        analysis["today-analysis<br>(today-analysis)"]
        explain["suggestion-explanation<br>(today-suggestion)"]
        mail["mail<br>(mail/)"]
    end

    base --> meal
    base --> export
    base --> recog
    base --> report
    base --> clinic
    base --> analysis
    base --> explain
    factory --> mail
```

### Queue Service Details

| Queue                  | Module                 | Concurrency | Result TTL | Notes                                  |
| ---------------------- | ---------------------- | ----------- | ---------- | -------------------------------------- |
| meal-analysis          | daily-records          | 1           | 30 min     | Image → LLM vision analysis            |
| data-export            | data-export            | 1           | 30 min     | Dashboard PDF generation               |
| medicine-recognition   | medicines              | 1           | 30 min     | Image → LLM medicine recognition       |
| report-summary         | reports/ai-summary     | 1           | 30 min     | LLM dashboard summary                  |
| clinic-pdf             | reports/clinic-summary | 1           | 30 min     | Clinic PDF with LLM summary            |
| today-analysis         | today-analysis         | 1           | 30 min     | LLM today analysis + SSE stream        |
| suggestion-explanation | today-suggestion       | 1           | 30 min     | LLM suggestion explanation             |
| mail                   | mail                   | 3           | —          | Transactional email (no async polling) |

In addition to the async job queues above, `CronJobsService` (`src/common/queue/cron-jobs.service.ts`)
manages two BullMQ repeatable-job queues for scheduled tasks:

| Queue                      | Schedulers                                    | Concurrency | Notes                                             |
| -------------------------- | --------------------------------------------- | ----------- | ------------------------------------------------- |
| `lucent-cron`              | `data-retention-cleanup`, `lifecycle-refresh` | 2           | Low-frequency cron jobs sharing one queue         |
| `lucent-reminder-dispatch` | `reminder-dispatch`                           | 1           | High-frequency medicine reminder dispatch (1 min) |

Schedulers are registered with `upsertJobScheduler` so cron rules survive restarts and update
idempotently. When a scheduler is moved between queues (for example, the `reminder-dispatch`
scheduler was split from `lucent-cron` into its own queue in 2026-07-29), the old scheduler must be
explicitly removed with `removeJobScheduler` to prevent stale jobs from being produced on the original
queue.

When Redis is unavailable, `BullmqQueueFactory` degrades to synchronous execution
(the job processor runs inline, results cached in cache-manager). Since 2026-08-03,
the same degradation also covers **enqueue-time** failures (Redis configured but
disconnected): `enqueueOrFallback` and the mail / meal-analysis / data-export
`enqueue` paths catch queue-add errors and fall back to synchronous processing
(logged per queue name) instead of returning 500. Meal-analysis enqueues without a
deterministic jobId — duplicate-job dedup is handled by the worker's revision
idempotency check, so a failed job can be re-enqueued with the same revision
during its 7-day retention window. Redis URL parsing is shared via
`common/helpers/infra/redis-url.ts` (queue factory + cache store), supporting
`family` / `db` query params and credentials.

## Security Elevation

Sensitive routes are protected by `SecurityElevationGuard` plus the `@RequireSecurityElevation()`
decorator. Elevation is granted by a short-lived signed JWT minted after verifying the user's
6-digit Security PIN. The guard reads the token from the `x-security-elevation` header as `Bearer
<token>` and stores the decoded payload on the request as `securityElevation`. Any PIN
enable/change/disable operation increments the user's `securityElevationVersion`, invalidating
prior elevation tokens.

## Audit Logging

`AuditLogModule` is a `@Global()` module that provides `AuditLogService` for recording
security-sensitive operations. `AccountController` calls `logFireAndForget()` after each
sensitive action (password change, email change, identity link/unlink, account deletion),
recording `userId`, `action`, `resourceType`/`resourceId`, `metadata`, `ipAddress`, and
`userAgent`. Write failures are swallowed (warn-level log) so audit never blocks user-facing
operations.

## Database

- **ORM**: Prisma 7 (client provider: `prisma-client`)
- **Schema**: `prisma/schema.prisma`
- **Generated client**: `src/generated/prisma/`
- **Key conventions**: `@map()` for snake_case columns, `@db.Timestamptz(3)` for timestamps,
  soft-delete via `deletedAt`
- **Health events**: `HealthEvent` owns user-confirmed active/ended periods, daily outcome
  check-ins, and current-medicine links. `UserDailyRecord` and `UserMedicineDoseLog` carry
  an optional `healthEventId`; records are never associated with the active event implicitly.
  The database partial unique index allows at most one non-deleted active event per user.

## Assistant RAG Data-Source Constraints

以下约束记录了 Assistant 三源检索架构的刻意设计边界，任何修改前必须理解：

- **源分离**：中文说明书（`leaflet_embeddings`）、DrugBank 科学文献（`drugbank_passage_embeddings`）、
  医学问答语料（`medical_qa_embeddings`）各自独立向量表 + 独立检索工具。不得合并为一个共享语料库
  或通用检索工具。
- **医学 QA 仅限 Assistant**：医学问答语料的检索结果仅供 Assistant 对话使用。前端线性服药流程
  （如 medication flows、daily records 展示）不得消费该语料的检索结果。放宽此限制需要单独的法律/
  产品决策。
- **无 CN→DrugBank 运行时映射表**：跨语言药品关联不通过运行时表或别名映射实现；跨源问题时使用
  Assistant 源分离结构化查找工具，而非建立共享映射层。
- **限流**：`ThrottlerConfigService`（`forRootAsync`）条件性启用 Redis 存储——`REDIS_URL` 存在时使用 ioredis INCR+PEXPIRE，否则回退内存。应用层级限流（如验证码 `assertClientRateLimit`）同样通过 `RedisService.atomicIncrement`（Lua 脚本原子 INCR+PEXPIRE）实现，Redis 不可用时回退到 cache-based read-check-write。
