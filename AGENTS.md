# AGENTS.md - Lucent

## Documentation Rules

After every code change, the following docs **MUST** be updated:

- Any backend code change
  - Update target: `docs/02-logs/migration-log/YYYY-MM-DD.md`
  - Action: Append change entry
- Current runtime/architecture state change
  - Update target: `docs/00-current/Current_State.md`
  - Action: Add/update completed item (create if missing)
- Closing a TODO item
  - Update target: `docs/00-current/TODO.md`
  - Action: Delete the line
- Finishing a plan section
  - Update target: `plans/*.md`
  - Action: Delete the entire section
- Env, Docker, or import flow change
  - Update target: `docs/01-reference/environment.md` + `README.md`
  - Action: Sync both

Completed items are **deleted** outright — no `✅`, `DONE`, strikethrough, or any other marker.

## Read First

- `README.md`
- `CONTRIBUTING.md`
- `docs/README.md`
- `docs/01-reference/environment.md`
- `docs/01-reference/environment-variables.md`
- `docs/01-reference/architecture.md`
- `docs/01-reference/adr/` for historical architecture decisions
- `docs/public/data-sources.md` (and `docs/public/data-sources-cn-products.md`,
  `docs/public/data-sources-drugbank.md`, `docs/public/data-sources-medical-qa.md`) when touching
  medicine import or source tables

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
- Env, Docker, import flow, or local commands changed: update `docs/01-reference/environment.md`,
  `docs/01-reference/environment-variables.md` (if variable details change), and `README.md`.
- Medicine import or source strategy changed: update `docs/public/data-sources.md` and the
  relevant source-specific file (`data-sources-cn-products.md`, `data-sources-drugbank.md`,
  `data-sources-medical-qa.md`, or `data-sources-food-composition.md`).
- Backend code changed: append a dated entry to `docs/02-logs/migration-log/YYYY-MM-DD.md` (create the file if it doesn't exist). Keep `docs/00-current/MigrationLog.md` as the index only.
- Significant architectural decision made: create an ADR in `docs/01-reference/adr/NNNN-title.md` following the template in `docs/01-reference/adr/README.md`.
- For localized backend copy, keep `AcceptLanguageResolver + I18nService` as the default path. Use `@I18nLang()` only when a controller/service flow must explicitly branch on the resolved locale and pass that locale deeper into AI/prompt/runtime code.
- Fix the requested problem directly; do not loosen TS/ESLint rules or refactor nearby working code.
- Use `pnpm typecheck` when you need TypeScript to validate spec and e2e files too; `pnpm build` excludes `**/*spec.ts` and `test/`.

## Module Subdirectory Whitelist

Every module directory must only contain the following subdirectories. New directories outside this whitelist require explicit justification.

### Standard (always allowed)

- `controllers/`
- `services/`
- `decorators/`
- `filters/`
- `guards/`
- `interceptors/`
- `pipes/`
- `middleware/`
- `tests/`
- `dto/`
- `entities/`
- `enums/`
- `types/`
- `constants/`
- `prompts/` — AI prompt copy and templates
- `schemas/` — AI output schemas and structured-response validators
- `strategies/` — Passport / authentication strategies

### Extended (allowed with review)

- `providers/` — OAuth providers, etc.
- `adapters/` — external service adapters
- `cache/` — cache service and admin controllers
- `utils/` — helper functions scoped to the module
- `agent/` — AI agent runtime (assistant only)
- `dashboard/` — dashboard sub-services (reports only)
- `tools/` — AI tool implementations (assistant only)

### Special

- `migrations/` — Prisma migrations (root-level only)
- `config/` — global configuration at root level; module-level `config/` is allowed only for runtime configuration objects/classes (not for constants, themes, or static helpers)
- `common/` — shared utilities, decorators, interceptors (root-level only)
- `prisma/` — Prisma service and schema (root-level only)
- `i18n/` — translation files (root-level only)

## Module Export Rules

- A service should be exported from its module (`exports` array in `@Module`) **iff** another module directly imports and uses it.
- Mapper services follow the naming convention `{domain}-mapper.service.ts`.
- Ownership services (for record/medicine checks) follow the naming convention `ownership.service.ts` and are placed in the owning module's `services/` directory.
