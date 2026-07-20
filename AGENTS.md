# AGENTS.md - Lucent

## Documentation Rules

After every code change, run the documentation check tool (`pnpm docs:check`) to confirm which documents need updating. It reads `docs/doc-map.yaml` and prints a per-rule report of which docs each touched code area expects. The pre-commit hook runs the same tool in **blocking** mode: `src/**/*.ts` staged but no `docs/` file staged → commit blocked. Bypass with `SKIP_DOC_CHECK=1`.

### Standing rules

- **Migration log**: append a dated entry to `docs/02-logs/migration-log/YYYY-MM-DD.md`.
- **Current state**: runtime/architecture changes go into the relevant `docs/00-current/*.md`
  sub-file, not into `Current_State.md` (index only).
- **Closing a TODO**: delete the line from `docs/00-current/TODO.md`.
- **Finishing a plan**: delete the entire section from `plans/*.md`.
- **Env/Docker/import/commands**: sync `docs/01-reference/environment.md`,
  `environment-variables.md`, and `README.md`.
- Completed items are **deleted** outright — no markers.

## Read First

- `README.md`, `CONTRIBUTING.md`, `docs/README.md`
- `docs/01-reference/environment.md`, `environment-variables.md`, `architecture.md`
- `docs/01-reference/adr/` for architecture decisions
- `docs/01-reference/contracts/data-sources.md` (and sub-files) when touching medicine import

## Current Baseline

- NestJS 11, Prisma 7, PostgreSQL, Redis, JWT auth.
- Dev DB: `postgres/postgres@127.0.0.1:15432/lucent`. Test DB: `lucent/lucent_dev@127.0.0.1:5432/lucent`.
- Redis: `redis://127.0.0.1:6379`.
- Response envelope: `{ code, message, data }`. Health check: `GET /api/v1/health`.

## Working Rules

- API contract changed → `pnpm export:openapi`. Do not hand-write endpoint docs.
- Architecture/module structure changed → `pnpm docs:compodoc`.
- API docs UI at `/api/docs` via Scalar.
- Medicine import strategy changed → update `data-sources.md` + relevant source-specific file.
- Significant architectural decision → create ADR in `docs/01-reference/adr/NNNN-title.md`.
- Localized backend copy: `AcceptLanguageResolver + I18nService` by default; `@I18nLang()` only
  when branching on locale for AI/prompt code.
- Fix the requested problem directly; do not loosen TS/ESLint rules or refactor nearby code.
- `pnpm typecheck` validates spec/e2e files too; `pnpm build` excludes `**/*spec.ts` and `test/`.

## File Naming Rules

**Core principle**: File name = responsibility, not location. Directory = namespace,
file name = WHAT it does.

NestJS framework suffixes (`.service.ts`, `.controller.ts`, `.module.ts`, `.dto.ts`, etc.)
**stay** — they are CLI-generated and expected by the framework.

1. **No module-name prefix on files inside the module.**
   - ❌ `legal-documents/services/legal-documents.service.ts` → ✅ `documents.service.ts`
2. **Module root files keep the module name** (CLI convention).
   - ✅ `legal-documents/legal-documents.controller.ts`, `legal-documents.module.ts`
3. **Never use a bare type word** (`service.ts`, `types.ts`, `constants.ts`). Add a business word.
4. **Sub-topic prefixes are fine** — `meal-analysis.constants.ts` is correct (`meal-analysis` is
   a sub-topic, not the module name `daily-records`).
5. **Sub-directory name prefix is redundant.**
   - ❌ `services/explanation/explanation-queue.service.ts` → ✅ `services/explanation/queue.service.ts`
6. **Class names are unaffected** — NestJS DI resolves by class name, not file name.
7. **Spec files follow their source** — co-located, renamed in lockstep.
8. **Domain sub-directories** when `services/` or `tools/` exceeds 8 files spanning 2+ areas.

## Barrel Exports

- Every sub-directory inside a module (`services/`, `dto/`, `tools/`, etc.) **must** have an
  `index.ts` re-exporting all public symbols — only `export *` statements, no logic.
- Cross-module imports go through barrels, not deep paths:
  - ❌ `import { XxxService } from '../auth/services/auth-token.service';`
  - ✅ `import { XxxService } from '../auth/services';`

## Module Subdirectory Whitelist

**Standard**: `controllers/`, `services/`, `decorators/`, `filters/`, `guards/`, `interceptors/`,
`pipes/`, `middleware/`, `tests/`, `dto/`, `entities/`, `enums/`, `types/`, `constants/`,
`prompts/`, `schemas/`, `strategies/`.

**Extended** (with review): `providers/`, `adapters/`, `cache/`, `utils/`, `agent/`, `dashboard/`,
`tools/`.

**Special** (root-level only): `migrations/`, `config/`, `common/`, `prisma/`, `i18n/`.

## Root `common/` Conventions

- No scattered files at `common/` root — every file lives in a role-based sub-directory.
- Role-based subdirectories: `api/`, `helpers/`, `services/`, `logger/`, `llm/`, `queue/`,
  `metrics/`, `events/`, `storage/`, `types/`, `filters/`, `interceptors/`, `middleware/`,
  `constants/`, `validators/`.
- Files needing Nest DI (`@Injectable()`, module wiring) should not live in `helpers/`.
- Every sub-directory has an `index.ts` barrel.

## Module Export Rules

- Export a service from `@Module` `exports` **iff** another module directly imports and uses it.
- Mapper services: `mapper.service.ts`. Ownership services: `ownership.service.ts`.
- Cross-module data access governed by [ADR-0009](docs/01-reference/adr/0009-cross-module-data-access.md):
  cross-module writes via owning module's exported service; cross-module reads on soft-delete
  models use shared `nonDeleted` helper.
