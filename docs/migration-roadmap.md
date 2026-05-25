# Migration Roadmap

Last updated: 2026-05-25

## Goal

Build Lucent into the production backend for Luminous:

- NestJS application structure.
- PostgreSQL as the primary database.
- Prisma for schema, migrations, and imports.
- Redis for verification codes, cooldowns, short-lived cache, and selected AI cache.
- Passport JWT for protected APIs.
- Versioned `/api/v1` protocol.

## Non-Goals

- Do not add new long-term backend features to `Luminous/backend`.
- Do not bundle `DrugDataBase` files into Flutter.
- Do not rely on request-body `userId` for authorization.
- Do not force Lucent to preserve the legacy Express envelope or route paths.

## Phases

1. Protocol foundation: define `/api/v1`, envelope, error codes, request id header, and JWT identity rules. Current status: initialized with `GET /api/v1/health`.
2. Infrastructure: add PostgreSQL, Prisma, Redis, config validation, and local development env files. Current status: SWC, config validation, env templates, and script modes are initialized; database, Redis, and Prisma are next.
3. Data fixtures: create small xlsx/DrugBank fixtures and import reports.
4. Knowledge schema: add product, instruction section, source metadata, search document, and DrugBank staging tables.
5. Public medicine APIs: implement search, detail, Markdown detail, and scan candidate lookup.
6. Auth and users: implement code delivery, register, login, refresh, profile, and Passport JWT guards.
7. User data APIs: implement my medicines, reminders, today reminders, and scan records.
8. Copilot and safety: ground AI outputs in PostgreSQL knowledge sections and user context.
9. Flutter migration: switch Flutter to the Lucent API client and `/api/v1` routes.
10. Production cutover: migrate data, switch deployment, monitor, and retire legacy Express runtime dependencies.

## Validation Gates

Each backend slice should pass:

```bash
pnpm build
pnpm test
```

Add e2e/contract coverage as APIs become stable:

```bash
pnpm test:e2e
```

Before production cutover:

- Prisma migrations rebuild an empty PostgreSQL database.
- Import scripts run on fixtures and representative data samples.
- Core Flutter flows pass against Lucent: login, medicine search/detail, scan, my medicines, reminders, and scan records.
- Legacy Express remains available only as rollback/reference during the cutover window.
