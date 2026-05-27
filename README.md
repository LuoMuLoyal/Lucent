# Lucent

[![Frontend](https://img.shields.io/badge/Frontend-Luminous-8b5cf6)](https://github.com/LuoMuLoyal/Luminous)

Lucent is the target backend for Luminous. It replaces the deprecated Express backend in `Luminous/backend`.

## Current Status

- `Luminous/backend` still powers the deployed legacy `https://devluo.com` service.
- Lucent is the mainline for all new backend work.
- Luminous includes Lucent as a Git submodule at `Luminous/Lucent`.

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

## Documentation

- [docs/README.md](docs/README.md): documentation map and ownership.
- [docs/api-contract.md](docs/api-contract.md): `/api` 前缀 + URI versioning、响应 envelope、auth 与错误码。
- [docs/data-sources.md](docs/data-sources.md): `DrugDataBase` source boundaries and import rules.
- [docs/environment.md](docs/environment.md): env files, scripts, and bootstrap baseline.
- [docs/migration-roadmap.md](docs/migration-roadmap.md): backend buildout phases.

## Submodule Workflow

When working from Luminous:

```bash
git submodule update --init --recursive
cd Lucent
```

Commit and push Lucent changes in this repository first. Then update and commit the submodule pointer in Luminous.
