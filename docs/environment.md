# Environment

Last updated: 2026-05-25

Lucent uses `@nestjs/config` with validated environment variables.

## Files

Runtime files are local only and must not be committed:

```text
.env.development
.env.production
.env.development.local
.env.production.local
```

Tracked templates:

```text
.env.example
.env.development.example
.env.production.example
```

Loading order is environment-specific:

```text
.env.<NODE_ENV>.local
.env.<NODE_ENV>
.env.local
.env
```

## Scripts

- `pnpm start` and `pnpm start:dev` run with `NODE_ENV=development`.
- `pnpm start:prod` runs the built app with `NODE_ENV=production`.
- `pnpm test` and `pnpm test:e2e` run with `NODE_ENV=test`.

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
- Versioning: URI versioning, default version `1`.
- Health check: `GET /api/v1/health`.
- Request id: returned in `X-Request-Id` and available for server-side log correlation.
