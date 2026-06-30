# AGENTS.md - Lucent

## Read First

- `README.md`
- `CONTRIBUTING.md`
- `docs/README.md`
- `docs/environment.md`
- `docs/architecture.md`
- `docs/adr/` for historical architecture decisions
- `docs/public/data-sources.md` when touching medicine import or source tables

## Current Baseline

- Runtime backend is `Lucent`; `Luminous/backend` is legacy.
- Stack: NestJS 11, Prisma 7, PostgreSQL, Redis, JWT auth.
- Local development DB: `postgres/postgres@127.0.0.1:15432/lucent`.
- Local test DB: `lucent/lucent_dev@127.0.0.1:5432/lucent`.
- Local Redis: `redis://127.0.0.1:6379`.
- Global response envelope stays `{ code, message, data }`.
- Health check stays at `GET /api/v1/health`.

## Working Rules

- API contract changed: run `pnpm export:openapi`; do not maintain hand-written endpoint docs.
- Backend architecture or module structure changed: run `pnpm docs:compodoc` to regenerate HTML architecture docs under `docs/compodoc/`.
- API documentation UI is served at `/api/docs` via Scalar (replaces Swagger UI). The underlying OpenAPI generation and export flow remain unchanged.
- Active multi-step backend task plans belong in `plans/*.md`, not in `docs/` and not in the workspace root.
- Env, Docker, import flow, or local commands changed: update `docs/environment.md` and `README.md`.
- Medicine import or source strategy changed: update `docs/public/data-sources.md`.
- Backend code changed: append a dated entry to `docs/migration-log/YYYY-MM-DD.md` (create the file if it doesn't exist). Keep `docs/MigrationLog.md` as the index only.
- Significant architectural decision made: create an ADR in `docs/adr/NNNN-title.md` following the template in `docs/adr/README.md`.
- For localized backend copy, keep `AcceptLanguageResolver + I18nService` as the default path. Use `@I18nLang()` only when a controller/service flow must explicitly branch on the resolved locale and pass that locale deeper into AI/prompt/runtime code.
- Fix the requested problem directly; do not loosen TS/ESLint rules or refactor nearby working code.
- Use `pnpm typecheck` when you need TypeScript to validate spec and e2e files too; `pnpm build` excludes `**/*spec.ts` and `test/`.

## Module Subdirectory Whitelist

Every module directory must only contain the following subdirectories. New directories outside this whitelist require explicit justification.

**Standard** (every module should use these as needed):

| Directory   | Purpose                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| `dto/`      | Data Transfer Objects. Must include an `index.ts` barrel export.                    |
| `services/` | Business-logic services. All `.service.ts` files go here; never in the module root. |
| `guards/`   | NestJS Guards. Only `.guard.ts` files that implement `CanActivate`.                 |

**Extended** (common cross-cutting concerns):

| Directory     | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| `config/`     | Module-level configuration (e.g. runtime options, provider configs). |
| `types/`      | Module-level TypeScript types and interfaces.                        |
| `decorators/` | Custom NestJS parameter / method / class decorators.                 |
| `strategies/` | Passport strategies.                                                 |
| `providers/`  | OAuth and third-party provider implementations.                      |

**Special** (domain-specific; require a clear reason to exist):

| Directory    | Purpose                                     | Example modules                    |
| ------------ | ------------------------------------------- | ---------------------------------- |
| `schemas/`   | DB / Zod / validation schemas               | daily-records, today-analysis      |
| `prompts/`   | AI prompt templates                         | assistant, reports, today-analysis |
| `tools/`     | AI Agent tool implementations               | assistant                          |
| `agent/`     | AI Agent runtime                            | assistant                          |
| `cache/`     | Caching layer                               | medicines                          |
| `sources/`   | Data-source adapters                        | medicines                          |
| `dashboard/` | Sub-feature grouping within a larger module | reports                            |

**Governance rules**:

1. New modules default to Standard directories only.
2. Adding a directory not in this whitelist must be justified in the PR description.
3. Do not place `.service.ts` files in the module root — they always belong in `services/`.
4. Mapper services follow `{domain}-mapper.service.ts` naming and live in `services/`. Ownership-verification services follow `ownership.service.ts` naming.

## Working Directory

Work inside `Lucent/` for pure backend changes. When operating from the workspace root, use `git -C Lucent ...` and absolute paths so commands run against this repo, not the workspace root or `Luminous`.

## Known Gotchas

- NestJS 11 cache module expects `stores`, not legacy `store`. If Redis is enabled, wrap the Redis store as a Keyv-backed store or the cache manager may silently fall back to memory semantics.
- `cache-manager` / Nest cache TTL is in milliseconds in this repo.
- DrugBank `full database.xml` is about 1.9 GB unzipped and contains nested structures; keep it on the scripted XML -> normalized tables path. Do not convert it to `xlsx` for routine import.
- Prisma 7 client provider is `prisma-client`, not `prisma-client-js`.
- Prisma output paths resolve relative to `schema.prisma`.
- Prefer native command flags such as `pnpm --prefix` and `git -C`.
- Empty NestJS modules may need a narrow eslint disable for `no-extraneous-class`.
