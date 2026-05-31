# Environment

Last updated: 2026-05-30

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
- `pnpm test:e2e` runs with `NODE_ENV=test` and `NODE_OPTIONS=--experimental-vm-modules` for Prisma 7 generated client compatibility.
- Prisma commands should be run with an explicit `NODE_ENV` when they are not targeting development. Example: `NODE_ENV=test pnpm exec prisma migrate deploy`.
- `pnpm export:openapi` builds Lucent first, then exports `docs/openapi.json` from `dist` so Prisma generated imports resolve correctly.
- `pnpm dev:stack:up` starts the local development stack from `docker-compose.dev.yml`.
- `pnpm db:migrate:all` runs Prisma generate plus migrate deploy for both the development and test databases.
- `pnpm import:medicine:all` runs the default medicine knowledge import sequence against `NODE_ENV=development`.
- `scripts/dev/import-medicine-datasets.ps1` accepts `-Command`, `-SourcePath`, `-Limit`, `-BatchSize`, `-SourceVersion`, and `-WithHash` for repeatable smoke or full imports.
- Local development expects `postgres/postgres@127.0.0.1:15432/lucent`.
- Local e2e expects `lucent/lucent_dev@127.0.0.1:5432/lucent`.

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
