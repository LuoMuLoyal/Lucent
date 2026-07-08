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
- **`pnpm test:ci`**: Unit tests in CI with `--runInBand`
- **`pnpm test:e2e`**: E2E tests with Prisma 7 VM-module compatibility
- **`pnpm test:e2e:ci`**: E2E tests in CI with `--runInBand`
- **`pnpm export:openapi`**: Build then export `docs/openapi.json` from `dist`
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

## Runtime Notes

- `GET /api/v1/health` is a readiness alias, not a pure liveness check. It returns dependency detail
  in the normal API envelope and uses HTTP `503` when a critical dependency is down.
- `GET /api/v1/health/live` stays cheap and process-only; use it for container liveness probes.
- `GET /api/v1/health/ready` checks PostgreSQL plus Redis when `REDIS_URL` is configured. Without
  `REDIS_URL`, cache health reports `memory` fallback and remains non-critical.
- `GET /api/v1/health/deep` keeps the same dependency checks but includes more explicit probe detail
  for diagnosis.
- Production compose only runs `postgres`, `redis`, `app`, and `nginx`.
- Production deploy now uses a simple two-directory layout:
  - app files at `/opt/lucent/app`
  - local runtime files at `/opt/lucent/server`
- Server-side deploy uses `/opt/lucent/app/deploy/docker-compose.yml` and
  `/opt/lucent/app/.env.compose`.
- Production PostgreSQL now follows the PostgreSQL 18 container layout and mounts
  `/opt/lucent/server/data/postgresql` to container path `/var/lib/postgresql`, not the legacy
  `/var/lib/postgresql/data`.
- `pnpm export:openapi` runs in explicit OpenAPI export mode and skips Prisma database connect
  during app startup so contract generation does not require a live DB connection.
- Production image must include `prisma.config.ts` together with `prisma/schema.prisma`; Prisma 7
  `migrate deploy` reads the datasource URL from that config file inside the container.
- AdminJS bundles its frontend assets at runtime during Nest bootstrap. Required Babel plugins for
  that bundle path must stay in production dependencies, not only devDependencies, or `/admin`
  startup can fail even after the container is already running app bootstrap code.
- i18n type generation writes `src/generated/i18n.generated.ts` only in source-tree development
  runtime.
- Lucent runtime logging now uses `nestjs-pino` with `pino-http`; development
  output is pretty-printed, while production stays JSON-first on stdout/stderr.
- `requestIdMiddleware` remains the source of truth for `X-Request-Id`; the
  request id is also bridged into a shared AsyncLocalStorage request context so
  exception and service logs can resolve the active request without passing
  `Request` through every layer.
- Automatic request/response logs intentionally suppress noisy
  `/api/v1/health*` and `/api/docs*` routes, but still keep request context for
  the rest of the request pipeline.
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
  for one target date.

## CI/CD Boundary

`.github/workflows/lucent-ci.yml` owns GitHub-side validation. `.github/workflows/lucent-cd.yml`
owns production image build, TCR push, deploy-asset upload, and remote deployment. For server
bootstrap and production deployment checks, use `deployment.md`.
