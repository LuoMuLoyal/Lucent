# AGENTS.md - Lucent

## Documentation Rules

After every code change, run the documentation check tool (`pnpm docs:check`) to confirm which documents need updating. It reads `docs/doc-map.yaml` (three tiers: `docs_required` all-must-update, usually just the migration log; `docs_any_of` at-least-one; `docs_info` suggested) and prints a per-rule report of which docs each touched code area expects. The pre-commit hook runs the same tool in **blocking** mode: `src/**/*.ts` staged but no `docs/` file staged → commit blocked. Bypass with `SKIP_DOC_CHECK=1`.

### Standing rules

- **Migration log**: append a dated entry to `docs/02-logs/migration-log/YYYY-MM-DD.md`.
  **Never overwrite** an existing entry — always append new sections below existing content.
  The pre-commit hook blocks commits where a staged migration-log file has more than 5 deleted
  lines (indicating overwrite rather than append).
  - Single-day log files keep exactly one `# ` H1; sections use `##` (no date prefix).
  - When referencing a plan file, note it was executed and the file is gone
    (「实施完毕文件已删」), otherwise `--verify` flags an orphan reference.
- **Current state**: runtime/architecture changes go into the relevant `docs/00-current/*.md`
  sub-file, not into `Current_State.md` (index only).
- **Closing a TODO**: delete the line from `docs/00-current/TODO.md`.
- **Finishing a plan**: delete the entire section from `plans/*.md`.
- **Env/Docker/import/commands**: sync `docs/01-reference/environment.md`,
  `environment-variables.md`, and `README.md`.
- **Doc lifecycle**: active docs older than 90 days without updates, or unreferenced by
  `doc-map.yaml`, are flagged by `node scripts/hooks/check-docs-updated.ts --verify` — review,
  update, or archive them to `docs/03-archive/`.
- Completed items are **deleted** outright — no markers.

## Read First

- `README.md`, `CONTRIBUTING.md`, `docs/README.md`
- `docs/01-reference/architecture.md`, `environment.md`, `environment-variables.md`
- `docs/01-reference/contracts/README.md`（改 API 时）、`docs/01-reference/adr/`（架构决策）
- 功能实现细节以代码为准；历史状态文档归档在 `docs/03-archive/`

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

- Each module has a single `index.ts` at the module root that explicitly exports
  the module's public API (services in `@Module().exports`, cross-module DTOs,
  types, decorators, guards). Use `export { X } from './path'` — never `export *`.
- No sub-directory barrels (`services/index.ts`, `dto/index.ts`, etc.) —
  sub-directories are internal namespaces, not export surfaces.
- Cross-module imports go through the module root barrel:
  - ❌ `import { XxxService } from '../auth/services/account.service';`
  - ✅ `import { XxxService } from '../auth';`
- Within a module, use deep-path imports:
  - ❌ `import { XxxService } from './services';`
  - ✅ `import { XxxService } from './services/account.service';`
- Module classes (`XxxModule`) are imported directly from the `.module.ts` file,
  not through the barrel, to avoid circular dependencies.

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
- `common/index.ts` is the single barrel; no sub-directory barrels.

## Module Export Rules

- Export a service from `@Module` `exports` **iff** another module directly imports and uses it.
- Mapper services: `mapper.service.ts`. Ownership services: `ownership.service.ts`.
- Cross-module data access governed by [ADR-0009](docs/01-reference/adr/0009-cross-module-data-access.md):
  cross-module writes via owning module's exported service; cross-module reads on soft-delete
  models use shared `nonDeleted` helper.
