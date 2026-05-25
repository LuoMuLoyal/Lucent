# Lucent

Lucent is the target backend for [Luminous](https://github.com/LuoMuLoyal/Luminous). It replaces the deprecated Express backend in `Luminous/backend`.

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
.env.development
.env.production
.env.example
```

Do not commit real environment files or local data imports.

## Documentation

- [docs/README.md](docs/README.md): documentation map and ownership.
- [docs/api-contract.md](docs/api-contract.md): `/api/v1`, response envelope, auth, and error rules.
- [docs/data-sources.md](docs/data-sources.md): `DrugDataBase` source boundaries and import rules.
- [docs/migration-roadmap.md](docs/migration-roadmap.md): backend buildout phases.

## Submodule Workflow

When working from Luminous:

```bash
git submodule update --init --recursive
cd Lucent
```

Commit and push Lucent changes in this repository first. Then update and commit the submodule pointer in Luminous.
