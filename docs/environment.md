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
```

## Scripts

- `pnpm start` and `pnpm start:dev` run with `NODE_ENV=development`.
- `pnpm start:prod` runs the built app with `NODE_ENV=production`.
- `pnpm test` runs with `NODE_ENV=test`.
- `pnpm test:e2e` runs with `NODE_ENV=test` and `NODE_OPTIONS=--experimental-vm-modules` for Prisma 7 generated client compatibility.
- Local e2e expects the `docker-compose.dev.yml` PostgreSQL service: `lucent/lucent_dev@127.0.0.1:5432/lucent`.

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
