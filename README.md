# Lucent

NestJS backend for Luminous. New backend work happens here; `Luminous/backend` is legacy production code.

## Stack

NestJS / PostgreSQL / Prisma / Redis / Passport JWT / OpenAI-compatible AI gateway

## Commands

```bash
pnpm install
pnpm start:dev
pnpm build
pnpm test
pnpm test:e2e
pnpm lint
pnpm export:openapi
```

`pnpm test:e2e` needs `docker-compose.dev.yml` PostgreSQL running at `127.0.0.1:5432`.

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
