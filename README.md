# Lucent

[![Frontend: Luminous](https://img.shields.io/badge/frontend-LuoMuLoyal%2FLuminous-16a34a?logo=github)](https://github.com/LuoMuLoyal/Luminous)

Lucent is the NestJS backend for Luminous. New backend work happens here; `Luminous/backend` is legacy reference code.

## Source Of Truth

- API contract: controller / DTO code plus generated [docs/openapi.json](docs/openapi.json).
- Database model: [prisma/schema.prisma](prisma/schema.prisma).
- Runtime configuration: [docs/environment.md](docs/environment.md).
- Medicine data imports: [docs/public/data-sources.md](docs/public/data-sources.md).
- Product direction: [../Luminous/docs/Product_Vision.md](../Luminous/docs/Product_Vision.md).

Hand-written endpoint mocks and commit-style changelogs are intentionally not maintained. Regenerate OpenAPI when API code changes:

```bash
pnpm export:openapi
```

## Stack

- NestJS 11
- Prisma 7 / PostgreSQL
- Redis / BullMQ
- Passport JWT
- WeChat Web / Mobile OAuth login
- OpenAPI-generated client/docs

## Local Development

```bash
pnpm install
pnpm dev:stack:up
pnpm db:migrate:all
pnpm start:dev
```

For the mobile full-stack E2E lane, run Lucent against the test database so
the test-only support route is available:

```bash
pnpm start:test:dev
```

That runtime enables `POST /api/v1/testing/fullstack-e2e/record-lane/prepare`,
which repairs a dedicated password-login test user and clears that user's daily
records for one target date before the Flutter lane starts.

The embedded AdminJS panel is available at `/admin`. In local development the
template credentials are `admin@lucent.local` / `admin12345`; override
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_COOKIE_SECRET` in your local env
file before exposing it.

Daily-record image uploads are signed by Lucent for Tencent COS. Configure
`TENCENT_COS_SECRET_ID`, `TENCENT_COS_SECRET_KEY`, `TENCENT_COS_BUCKET`, and
`TENCENT_COS_REGION` to enable `POST /api/v1/user/daily-records/attachments/images/presign-upload`.

Local database layout:

- development DB: `postgres/postgres@127.0.0.1:15432/lucent`
- test / e2e DB: `lucent/lucent_dev@127.0.0.1:5432/lucent`
- Redis: `redis://127.0.0.1:6379`

## Verification

```bash
pnpm lint:check
pnpm build
pnpm test:ci
pnpm test:e2e:ci
pnpm export:openapi
```

Use narrower commands while iterating, then run the relevant broader checks before finishing a backend change.

## Source Layout

- `src/modules/` contains business feature modules: auth, account, user, health context, daily records, dose logs, medicines.
- Top-level `src/` keeps app bootstrap and infrastructure/runtime support: `common`, `config`, `generated`, `i18n`, `mail`, `prisma`.
- `scripts/` contains local dev, OpenAPI export, deployment, and medicine import helpers.

## Docs

Start with [docs/README.md](docs/README.md).

Active docs:

- [docs/environment.md](docs/environment.md)
- [docs/tencent-cloud-cicd.md](docs/tencent-cloud-cicd.md)
- [docs/openapi.json](docs/openapi.json)
- [docs/public/data-sources.md](docs/public/data-sources.md)
- [docs/public/reminder-contract.md](docs/public/reminder-contract.md)
- [docs/public/environment-contract.md](docs/public/environment-contract.md)
