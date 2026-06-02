# Environment

Last updated: 2026-06-01

Lucent uses `@nestjs/config` with validated environment variables.

## Files

每个环境使用一个独立的 `.env.<NODE_ENV>` 文件，所有变量（含公共）集中在一个文件中。

Runtime files are local only and must not be committed:

```text
.env.development
.env.production
.env.test
.env.development.local
.env.production.local
```

Tracked templates:

```text
.env.development.example
.env.production.example
```

Loading order is environment-specific（优先级从高到低）：

```text
.env.<NODE_ENV>.local
.env.<NODE_ENV>
.env
```

Prisma CLI uses the same resolution order through `prisma.config.ts`, so `NODE_ENV=test` and `NODE_ENV=production` target the expected database automatically.

## Scripts

- `pnpm start` and `pnpm start:dev` run with `NODE_ENV=development`.
- `pnpm start:prod` runs the built app with `NODE_ENV=production`.
- `pnpm test` runs with `NODE_ENV=test`.
- `pnpm test:ci` runs unit tests with `NODE_ENV=test` and `--runInBand` for GitHub Actions.
- `pnpm test:e2e` runs with `NODE_ENV=test` and `NODE_OPTIONS=--experimental-vm-modules` for Prisma 7 generated client compatibility.
- `pnpm test:e2e:ci` runs e2e tests with the same test env plus `--runInBand` for GitHub Actions.
- Prisma commands should be run with an explicit `NODE_ENV` when they are not targeting development. Example: `NODE_ENV=test pnpm exec prisma migrate deploy`.
- `pnpm export:openapi` builds Lucent first, then exports `docs/openapi.json` from `dist` so Prisma generated imports resolve correctly.
- i18n type generation only writes `src/generated/i18n.generated.ts` when Lucent is running from the source tree in `NODE_ENV=development`; compiled `dist` runtime and `pnpm export:openapi` no longer attempt to write or read `dist/generated/i18n.generated.ts`.
- `pnpm dev:stack:up` starts the local development stack from `docker-compose.dev.yml`.
- `pnpm db:migrate:all` runs Prisma generate plus migrate deploy for both the development and test databases.
- `pnpm import:medicine:all` runs the default medicine knowledge import sequence against `NODE_ENV=development`.
- `scripts/dev/import-medicine-datasets.ps1` accepts `-Command`, `-SourcePath`, `-Limit`, `-BatchSize`, `-SourceVersion`, and `-WithHash` for repeatable smoke or full imports.
- Local development expects `postgres/postgres@127.0.0.1:15432/lucent`.
- Local e2e expects `lucent/lucent_dev@127.0.0.1:5432/lucent`.

## GitHub Actions CI/CD

This repo includes `.github/workflows/deploy-server.yml` as the full Lucent CI/CD pipeline.

If you are deploying to a Tencent Cloud CVM, read `tencent-cloud-cicd.md` together with this file. That guide is the operator-facing runbook for the current registry and server workflow.

### Pipeline shape

- `pull_request` / `push`
  - start PostgreSQL 18 + Redis 8 in GitHub Actions
  - run `pnpm exec prisma generate`
  - run `pnpm exec prisma migrate deploy`
  - run `pnpm lint:check`
  - run `pnpm build`
  - run `pnpm test:ci`
  - run `pnpm test:e2e:ci`
- `push` to `main`
  - build `linux/amd64` Docker image for the Guangzhou 2c4g production server
  - push immutable tag `sha-<commit>` plus `latest` to the configured registry
  - SSH to the server
  - sync `docker-compose.yml` and `scripts/deploy/deploy-server.sh` to the server over SSH
  - write `.deploy-image.env`
  - `docker compose pull postgres redis app`
  - keep PostgreSQL / Redis data volumes, recreate containers from the synced compose file
  - wait for Docker health checks and rollback `app` to the previous image if the new image fails to become healthy
- GitHub-hosted JavaScript actions are forced onto the Node 24 runtime via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` so the workflow no longer depends on the deprecated Node 20 actions runtime.
- Production still expects fixed registry tags for PostgreSQL and Redis: `<registry>/<namespace>/<image-name>-postgres:18-alpine` and `<registry>/<namespace>/<image-name>-redis:8-alpine`. Seed those two images into the target registry once before the first deployment.

### Expected server shape

- a writable deployment directory on the server
- Docker Engine + Docker Compose plugin installed
- `.env.production` stored in the repo root on the server
- outbound access from the server to:
  - your container registry

For mainland China servers, the target registry should be a registry that your server can access reliably, such as Tencent TCR or Alibaba Cloud ACR. Do not leave production on `ghcr.io` if the server cannot pull from it.

### Required GitHub secrets

- `SERVER_HOST`
- `SERVER_PORT`
- `SERVER_USER`
- `SERVER_SSH_KEY`
- `SERVER_KNOWN_HOSTS`
- `REGISTRY_USERNAME`
- `REGISTRY_PASSWORD`

`REGISTRY_PASSWORD` should be able to push from GitHub Actions and pull on the server. For GHCR, use a PAT with at least `read:packages` and `write:packages`.

### Required GitHub variables

- `SERVER_APP_DIR`
  Example: `/opt/lucent`

### Optional GitHub variables

- `REGISTRY_HOST`
  Default: `ghcr.io`
- `REGISTRY_NAMESPACE`
  Default: lowercased `github.repository_owner`
- `REGISTRY_IMAGE_NAME`
  Default: lowercased repository name

Recommended mainland setup:

- all runtime images pulled from the same domestic registry
- server only needs outbound access to that registry, not to GitHub or Docker Hub
- for Tencent Cloud CVM + GitHub-hosted Actions, prefer `TCR Individual` first; see `tencent-cloud-cicd.md`

### First-time server bootstrap

```bash
mkdir -p /opt/lucent
cd /opt/lucent
cat > .env.production <<'EOF'
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
CORS_ORIGIN=https://your-domain.example
DATABASE_URL=postgresql://lucent:lucent_dev@postgres:5432/lucent?schema=public
REDIS_URL=redis://redis:6379
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=14d
JWT_ACCESS_SECRET=replace_with_strong_access_secret
JWT_REFRESH_SECRET=replace_with_strong_refresh_secret
AI_PROVIDER=openai-compatible
AI_API_KEY=
AI_BASE_URL=
AI_TEXT_MODEL=
AI_VISION_MODEL=
MAIL_DRIVER=smtp
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_FROM=noreply@example.com
MAIL_USER=your_email@example.com
MAIL_PASS=your_password
LOG_LEVEL=info
EOF
```

Then edit `.env.production`, especially:

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `CORS_ORIGIN`

In the default single-server compose deployment, `DATABASE_URL` and `REDIS_URL` are pinned to the local `postgres` / `redis` containers by `docker-compose.yml`. If you want to use external services instead, update both `.env.production` and `docker-compose.yml`.

### Runtime files on the server

- `.env.production`
- `.deploy-image.env`
- `docker-compose.yml`
- `scripts/deploy/deploy-server.sh`

Only `.env.production` and `.deploy-image.env` are runtime-local and must not be committed.

## Production Rules

Production startup requires:

```text
DATABASE_URL
REDIS_URL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
CORS_ORIGIN
```

`CORS_ORIGIN=*` is allowed for local development but rejected in production.

## Current Baseline

- Compiler: Nest CLI SWC builder with type checking enabled.
- Global prefix: `/api`.
- Versioning: NestJS URI versioning，默认版本 `1`。
- Health check: `GET /api/v1/health`.
- Request id: returned in `X-Request-Id` and available for server-side log correlation.
- Auth e2e baseline passes for register / login / refresh / me / logout.
- Cache manager is global. When `REDIS_URL` is set, Lucent uses Redis through a Keyv-backed Nest cache store; when `REDIS_URL` is absent, it falls back to in-memory cache.
- Medicine knowledge reads currently use service-layer cache keys under the `medicines:` prefix. Search cache TTL is 5 minutes; detail cache TTL is 15 minutes.
- Frontend may send `x-bypass-cache: true` (also accepts `1`, `yes`, or `no-cache`) on medicines read requests to bypass cache for that request only.
- Medicine import scripts scan Redis for medicines cache entries under the active Keyv namespace and invalidate the matching logical `medicines:*` keys after import when `REDIS_URL` is configured.
