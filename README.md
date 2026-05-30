# Lucent

NestJS backend for Luminous. New backend work happens here; `Luminous/backend` is legacy production code.

## Stack

NestJS / PostgreSQL / Prisma / Redis / Passport JWT / OpenAI-compatible AI gateway

## Commands

```bash
pnpm install
pnpm dev:stack:up
pnpm db:migrate:all
pnpm start:dev
pnpm build
pnpm test
pnpm test:e2e
pnpm lint
pnpm export:openapi
```

Local database layout:

- development DB: `postgres/postgres@127.0.0.1:15432/lucent`
- test / e2e DB: `lucent/lucent_dev@127.0.0.1:5432/lucent`

`pnpm dev:stack:up` starts both PostgreSQL services plus Redis. `pnpm db:migrate:all` applies Prisma migrations to both local databases.

## Baseline

- API: `/api/v1`
- Health: `GET /api/v1/health`
- Response envelope: `{ code, message, data }`
- Language: `Accept-Language`, fallback `en`
- Auth e2e: register / login / refresh / me / logout

## Docs

Start with [docs/README.md](docs/README.md).

Key docs:

- [docs/public/api-contract.md](docs/public/api-contract.md)
- [docs/auth-api-mock.md](docs/auth-api-mock.md)
- [docs/environment.md](docs/environment.md)
- [CHANGELOG.md](CHANGELOG.md)
