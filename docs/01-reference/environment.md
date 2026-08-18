---
status: active
owner: backend
quadrant: reference
updated: 2026-08-18
---

# Lucent Environment

本文档保留本地环境、Docker 和快速命令总览。

详细参考：[[environment-variables]]

## Env Files

Runtime files are local only and must not be committed:

```text
.env.development
.env.production
.env.test
.env.development.local
.env.production.local
.env.test.local
```

Tracked templates:

```text
.env.development.example
.env.test.example
.env.production.example
```

Loading order, highest priority first:

```text
.env.<NODE_ENV>.local
.env.<NODE_ENV>
```

Lucent runtime, Prisma CLI, and medicine import scripts all use the same
explicit resolution order above. There is no root `.env` fallback anymore.

## Local Baseline

- Development DB: `postgres/postgres@127.0.0.1:15432/lucent`
- Test/e2e DB: `lucent/lucent_dev@127.0.0.1:5432/lucent`
- Redis: `redis://127.0.0.1:6379`
- Global prefix: `/api`
- URI versioning default: `1`
- Runtime probes:
  - `GET /api/v1/health` readiness alias
  - `GET /api/v1/health/live` liveness
  - `GET /api/v1/health/ready` readiness
  - `GET /api/v1/health/deep` diagnostic dependency probe
- Public reverse proxy ports:
  - Nginx HTTP redirect: `80`
  - Nginx HTTPS entrypoint: `443`
- Admin panel: `GET /admin`

Start local infrastructure:

```bash
pnpm dev:stack
pnpm db:migrate
pnpm start:dev
```

Local Docker stack note:

- `pnpm dev:stack` now starts `postgres-dev` and `postgres-test` from `pgvector/pgvector:pg18`, not
  plain `postgres:18-alpine`.
- This is required for assistant RAG indexing and query-time vector search because Lucent's local
  scripts call `CREATE EXTENSION vector` / `PGVectorStore.ensureTableInDatabase()`.
- GitHub Actions CI now also uses `pgvector/pgvector:pg18` for its PostgreSQL service so local and
  hosted validation exercise the same extension-capable database family.
- If you previously created local PostgreSQL volumes from the plain Postgres image, recreating the
  containers is usually enough. If the old volume state is incompatible or still lacks the extension
  binary, remove the local dev/test volumes and let Docker initialize them again.

## Scripts

- **`pnpm typecheck`**: Full TypeScript check for app/runtime code in `src/`, `*.spec.ts`, and
  `test/`
- **`pnpm typecheck:tools`**: TypeScript check for repo helper scripts in `scripts/` and `deploy/`
- **`pnpm check`**: One-command validation: lint, typecheck, build, unit, e2e
- **`pnpm start` / `pnpm start:dev`**: Development runtime with `NODE_ENV=development`
- **`pnpm start:test:dev`**: Test runtime with `NODE_ENV=test` for full-stack lane support
- **`pnpm start:prod`**: Built production runtime with `NODE_ENV=production`
- **`pnpm test`**: Unit tests with `NODE_ENV=test`
- **`pnpm test:ci`**: Unit tests in CI with `fileParallelism: false` (sequential execution)
- **`pnpm test:e2e`**: E2E tests with Prisma 7 VM-module compatibility
- **`pnpm test:e2e:ci`**: E2E tests in CI with `fileParallelism: false` (sequential execution)
- **`pnpm export:openapi`**: Build then export `docs/openapi.json` from `dist`
- **`pnpm openapi:export`**: Export OpenAPI spec only (no build — reuse existing `dist/`)
- **`pnpm dev:stack:down`**: Stop local Docker dev stack (Postgres + Redis)
- **`pnpm dev:stack:reset`**: Tear down local Docker dev stack volumes and recreate
- **`pnpm db:reset:dev`**: Reset development database (prisma migrate reset --force)
- **`pnpm db:reset:test`**: Reset test database (prisma migrate reset --force)
- **`pnpm import:medicine:all`**: Default medicine knowledge import sequence
- **`pnpm deploy:smoke`**: Post-deploy smoke check for running services and health endpoints

Repo helper layout:

- `scripts/dev/`: local runtime helpers such as test runtime start/stop and local stack bootstrap
- `scripts/contract/`: contract export helpers such as OpenAPI generation
- `scripts/import/medicine/`: medicine import entrypoints, fixtures, and Python parsers
- `test/e2e/`: feature-grouped e2e suites

Local helper scripts:

- `pnpm test:runtime:start`
  first applies pending Prisma migrations against the `NODE_ENV=test` database,
  starts `pnpm start:test:dev` in the background, writes `.runtime-test.pid`
  plus `.runtime-test.log`, and waits for `GET /api/v1/health`. The helper now
  uses a platform-specific `pnpm` executable (`pnpm.cmd` on Windows) so the
  full-stack lane can start correctly from PowerShell on Windows workstations.
- `pnpm test:runtime:stop`
  stops the Lucent test runtime tracked by `.runtime-test.pid`.

TypeScript project note:

- `scripts/tsconfig.json` and `deploy/tsconfig.json` inherit the root decorator settings so helper
  scripts can safely import Nest app modules without failing on constructor parameter decorators
  such as `@Inject(...)`.

Run Prisma commands with explicit `NODE_ENV` when not targeting development, for example:

```bash
NODE_ENV=test pnpm exec prisma migrate deploy
```

## JPush

服务端推送通过 JPush REST API 按用户 alias 投递。`JPUSH_APP_KEY` 与
`JPUSH_MASTER_SECRET` 必须同时配置；两者都为空时推送保持静默禁用，不影响其他业务；
仅配其中一项会导致启动失败，必须成对配置。Master Secret 只能通过本地未跟踪环境文件
或部署 secret 注入。`JPUSH_APNS_PRODUCTION` 必须与 Luminous 的 iOS provisioning/APNs
环境匹配。

生产 `.env` 需配齐 `JPUSH_APP_KEY` / `JPUSH_MASTER_SECRET`（经 `/opt/lucent/.env`
注入，不入库，见 [[deployment]]）。缺失时服务在启动日志输出一条 `warn`
（`JPush is not configured — push delivery is silently disabled.`），推送静默禁用；
`deploy/deploy.ts` 预检（[1/12]）同样会给出高亮 WARNING（不阻塞部署）。
0.1.0 发布门槛要求密钥已配齐并经真机验证，见 [[deployment]] 最低上线检查。

## Runtime Notes

- `GET /api/v1/health` is a readiness alias, not a pure liveness check. It returns dependency detail
  in the normal API envelope and uses HTTP `503` when a critical dependency is down.
- `GET /api/v1/health/live` stays cheap and process-only; use it for container liveness probes.
- `GET /api/v1/health/ready` checks PostgreSQL plus Redis when `REDIS_URL` is configured. Without
  `REDIS_URL`, cache health reports `memory` fallback and remains non-critical.
- `GET /api/v1/health/deep` keeps the same dependency checks but includes more explicit probe detail
  for diagnosis.
- Production compose runs `postgres`, `redis`, `app` (single slot), `nginx`, `prometheus`,
  `grafana`, plus `postgres-exporter`, `redis-exporter`, and `node-exporter`; `alertmanager`
  runs only when the `alerting` profile is enabled. See [[deployment]] for the full service
  list and architecture.
- Production deploy uses a single `/opt/lucent/` directory layout — see [[deployment]] for details.
- Production PostgreSQL uses `pgvector/pgvector:pg18` (same as local dev and CI) and mounts
  `./data/postgresql` to container path `/var/lib/postgresql`.
- `pnpm export:openapi` runs in explicit OpenAPI export mode and skips Prisma database connect
  during app startup so contract generation does not require a live DB connection.
- Production image must include `prisma.config.ts` together with the entire `prisma/` directory
  (multi-file schema: `schema.prisma` + `models/*.prisma`); Prisma 7 `migrate deploy` reads the
  datasource URL from that config file inside the container.
- AdminJS bundles its frontend assets at runtime during Nest bootstrap. Required Babel plugins for
  that bundle path must stay in production dependencies, not only devDependencies, or `/admin`
  startup can fail even after the container is already running app bootstrap code.
- i18n type generation writes `src/generated/i18n.generated.ts` only in source-tree development
  runtime.
- Lucent runtime logging uses `nest-winston` with Winston transports.
  Development console output uses a colorized `printf` format (timestamp,
  level, context, `[trace=xxxxxxxx]`, message, metadata, stack); production
  and test use single-line JSON with a `timestamp` field for log-aggregation
  tools. Set `LOG_FORMAT=pretty|json` to override the default at any
  environment.
- Inside an active OpenTelemetry span, every log line carries top-level
  `trace_id` / `span_id` (from `src/common/logger/trace-context.utils.ts`);
  span-less contexts (startup, cron, queue workers) skip injection. The former
  `requestIdMiddleware` / `RequestContextService` (AsyncLocalStorage) and the
  `X-Request-Id` response header have been retired — see ADR-0010.
- Automatic request/response logs intentionally suppress noisy
  `/api/v1/health*` and `/api/docs*` routes, but still keep request context for
  the rest of the request pipeline. (HTTP access logging is no longer handled
  by a logging middleware; Nginx, `ApiExceptionFilter`, and `SlowRequestInterceptor`
  cover the remaining observability needs.)
- When `REDIS_URL` is set, Lucent uses Redis through a Keyv-backed Nest cache store; without it,
  cache falls back to memory.
- Mail delivery uses BullMQ when `REDIS_URL` is set and immediate send when Redis is absent.
- WeChat Web OAuth state is cached for 10 minutes. Desktop login may include a loopback callback URI
  in OAuth state.
- Daily-record image uploads use presigned Tencent COS PUT URLs; clients upload directly to COS,
  then save returned attachment metadata on the daily record.
- Report PDF exports also reuse Tencent COS. Lucent uploads the generated PDF from the server side,
  stores the COS object key in `data_export_requests`, and returns a short-lived signed GET URL
  through the latest export status API.
- Generated report PDFs now include repeated page header/footer chrome, page numbers, and PDF
  metadata so exported files are usable outside the app as standalone documents.
- Medicine search cache TTL is 5 minutes; medicine detail cache TTL is 15 minutes.
- Frontend reads may send `x-bypass-cache: true` to bypass medicine read cache for one request.
- `POST /api/v1/testing/fullstack-e2e/record-lane/prepare` exists only when Lucent runs with
  `NODE_ENV=test`. It is intentionally absent from normal development and production runtime, and is
  meant only to repair a dedicated full-stack test user plus clear that user's daily-record slice
  for one target date. In test mode, all `/api/v1/testing/*` endpoints are protected by both
  `JwtAuthGuard` and `TestingSharedSecretGuard` (requiring `x-testing-shared-secret` header matching
  `TESTING_SHARED_SECRET`).
- Production runtime enables Helmet middleware for HTTP security headers (CSP,
  X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, etc.),
  complementing the Nginx-layer security headers.
- When `METRICS_USER` and `METRICS_PASSWORD` are both set, the `/metrics` endpoint
  requires HTTP Basic Auth. Prometheus scrape config must include matching
  `basic_auth` credentials. Nginx blocks external `/metrics` access with `403`
  as defense-in-depth.
- Production environment sets `TRUST_PROXY=true` so Express correctly parses
  `X-Forwarded-*` headers from Nginx.

## CI/CD Boundary

`.github/workflows/lucent-ci.yml` owns GitHub-side validation. `.github/workflows/lucent-production.yml`
and `.github/workflows/lucent-staging.yml` own production/staging image build, TCR push,
deploy-asset upload, and remote deployment. For server bootstrap and production deployment
checks, use `deployment.md`.
