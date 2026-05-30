# Lucent

[![Frontend](https://img.shields.io/badge/Frontend-Luminous-8b5cf6)](https://github.com/LuoMuLoyal/Luminous)

Lucent is the target backend for Luminous. It replaces the deprecated Express backend in `Luminous/backend`.

## Current Status

- `Luminous/backend` still powers the deployed legacy `https://devluo.com` service.
- Lucent is the mainline for all new backend work.
- Lucent lives alongside `Luminous/` inside the shared `Lumos/` workspace.

## Stack

- NestJS
- PostgreSQL
- Prisma
- Redis
- Passport JWT
- OpenAI-compatible AI gateway

## Development

```bash
pnpm install
pnpm start:dev
```

```bash
pnpm build
pnpm test
pnpm test:e2e
pnpm lint
```

Environment files:

```text
.env.example
.env.development.example
.env.production.example
```

Local runtime files:

```text
.env.development
.env.production
```

Do not commit real environment files or local data imports.

Current baseline:

- Nest CLI uses SWC for application builds.
- Runtime config loads `.env.development` and `.env.production` by convention.
- API 全局 prefix `/api` + NestJS URI versioning（`/v1`），health check: `GET /api/v1/health`。
- i18n uses `Accept-Language` request header, with fallback language `en`.

## Documentation

### 共享文档（`docs/public/`）

- [docs/public/README.md](docs/public/README.md): shared documentation map.
- [docs/public/Promise.md](docs/public/Promise.md): product vision.
- [docs/public/ROADMAP.md](docs/public/ROADMAP.md): product roadmap and current milestones.
- [docs/public/design-system.md](docs/public/design-system.md): design token specification.
- [docs/public/api-contract.md](docs/public/api-contract.md): `/api` prefix + URI versioning, response envelope, auth, and error codes.
- [docs/public/data-sources.md](docs/public/data-sources.md): `DrugDataBase` source boundaries and import rules.

### Lucent 专属文档（`docs/`）

- [docs/auth-api-mock.md](docs/auth-api-mock.md): auth module RESTful API specification.
- [docs/auth-implementation-plan.md](docs/auth-implementation-plan.md): auth implementation roadmap.
- [docs/environment.md](docs/environment.md): env files, scripts, and bootstrap baseline.
- [docs/migration-roadmap.md](docs/migration-roadmap.md): backend buildout phases.

## Workspace Note

Current local layout:

```text
Lumos/
  Luminous/
  Lucent/
```

Work on `Lucent/` directly in this workspace. Do not rely on old submodule instructions.
