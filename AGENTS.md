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
- `docs/01-reference/contracts/data-sources.md` (and `docs/01-reference/contracts/data-sources-cn-products.md`,
  `docs/01-reference/contracts/data-sources-drugbank.md`, `docs/01-reference/contracts/data-sources-medical-qa.md`) when touching
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

- API contract changed: run `pnpm export:openapi`; local `docs/openapi.json` stays ignored, and you
  still must not maintain hand-written endpoint docs.
- Backend architecture or module structure changed: run `pnpm docs:compodoc` to regenerate HTML architecture docs under `docs/compodoc/`.
- API documentation UI is served at `/api/docs` via Scalar (replaces Swagger UI). The underlying OpenAPI generation and export flow remain unchanged.
- Active multi-step backend task plans belong in `plans/*.md`, not in `docs/` and not in the workspace root.
- Env, Docker, import flow, or local commands changed: update `docs/01-reference/environment.md`,
  `docs/01-reference/environment-variables.md` (if variable details change), and `README.md`.
- Medicine import or source strategy changed: update `docs/01-reference/contracts/data-sources.md` and the
  relevant source-specific file (`data-sources-cn-products.md`, `data-sources-drugbank.md`,
  `data-sources-medical-qa.md`, or `data-sources-food-composition.md`).
- Backend code changed: append a dated entry to `docs/02-logs/migration-log/YYYY-MM-DD.md` (create the file if it doesn't exist). Keep `docs/00-current/MigrationLog.md` as the index only.
- Significant architectural decision made: create an ADR in `docs/01-reference/adr/NNNN-title.md` following the template in `docs/01-reference/adr/README.md`.
- For localized backend copy, keep `AcceptLanguageResolver + I18nService` as the default path. Use `@I18nLang()` only when a controller/service flow must explicitly branch on the resolved locale and pass that locale deeper into AI/prompt/runtime code.
- Fix the requested problem directly; do not loosen TS/ESLint rules or refactor nearby working code.
- Use `pnpm typecheck` when you need TypeScript to validate spec and e2e files too; `pnpm build` excludes `**/*spec.ts` and `test/`.

## File Naming Rules

### Core Principle: File Name = Responsibility, Not Location

```
Directory = namespace (tells you the module/layer)
File name = specific responsibility (tells you WHAT it does, not WHERE it is)
```

### NestJS Framework Suffixes Are Not Redundant

Unlike Flutter's `_provider` / `_page` suffixes (which are community habits), NestJS framework
suffixes — `.service.ts`, `.controller.ts`, `.module.ts`, `.dto.ts`, `.guard.ts`,
`.interceptor.ts`, `.pipe.ts`, `.filter.ts`, `.decorator.ts` — are **CLI-generated and expected by
the framework toolchain**. These suffixes **stay**. They are file-type identifiers, not redundant
type words.

The problem in Lucent is **module-name prefix duplication**, not suffix redundancy.

### Quality Hierarchy (NestJS edition)

| Level     | Example (in `legal-documents/services/`) | Problem                                                     |
| --------- | ---------------------------------------- | ----------------------------------------------------------- |
| **Worst** | `service.ts`                             | Zero responsibility — can't distinguish from other services |
| Redundant | `legal-documents.service.ts`             | Prefix repeats the module directory                         |
| **Best**  | `documents.service.ts`                   | Prefix = responsibility, suffix = framework convention      |

### Rules

1. **No module-name prefix on files inside the module.** A file inside `legal-documents/services/`
   must not start with `legal-documents-`; the directory already says the module.
   - ❌ `legal-documents/services/legal-documents.service.ts` → ✅ `documents.service.ts`
   - ❌ `user-health-context/services/health-context.service.ts` → ✅ already good (`health-context`
     is a responsibility word, not the module name `user-health-context`)

2. **Module root files keep the module name.** `xxx.controller.ts`, `xxx.module.ts`, and
   `xxx.service.ts` (if the main service lives at the module root) retain the module-name prefix.
   These are NestJS CLI conventions for the module entry point.
   - ✅ `legal-documents/legal-documents.controller.ts`
   - ✅ `legal-documents/legal-documents.module.ts`

3. **Never use a bare type word as a file name.** `service.ts`, `types.ts`, `constants.ts` carry
   zero responsibility. Always include a business word to distinguish from siblings.
   - ❌ `services/service.ts` (when siblings exist) → ✅ `services/token.service.ts`
   - ✅ `services/queue.service.ts` inside `services/explanation/` — when only one service lives in
     a domain sub-directory, `service.ts` is acceptable because the directory name is the
     responsibility word

4. **`.service.ts` suffix is mandatory** for all `@Injectable()` service files, following NestJS
   convention. Same for `.controller.ts`, `.module.ts`, `.dto.ts`, etc.

5. **Sub-topic prefixes are not module-name prefixes.** `meal-analysis.constants.ts` inside
   `daily-records/constants/` is correct — `meal-analysis` is a sub-topic, not the module name
   `daily-records`.
   - ❌ `daily-records/constants/daily-records.constants.ts` → ✅ `daily-records/constants/constants.ts`
   - ✅ `daily-records/constants/meal-analysis.constants.ts` (keep — sub-topic prefix)

6. **Sub-directory name prefix is redundant.** A file inside `services/explanation/` must not
   repeat `explanation-` in the file name.
   - ❌ `services/explanation/explanation-queue.service.ts` → ✅ `services/explanation/queue.service.ts`

7. **Class names are unaffected.** NestJS DI resolves by class name (e.g., `LegalDocumentsService`),
   not file name. File renames do not require class renames or DI changes.

8. **Spec files follow their source.** `*.spec.ts` must sit next to the file it tests and be
   renamed in lockstep.
   - ❌ `daily-records/daily-records.service.spec.ts` (root, name mismatch)
   - ✅ `daily-records/services/records.service.spec.ts` (co-located, name matches source)

9. **Domain sub-directories**: when `services/` or `tools/` contains more than 8 files spanning 2+
   functional areas, split into domain sub-directories (e.g. `services/oauth/`, `tools/drugbank/`).

### Decision Flow

```
File name has a responsibility word (not just the module name)?
├─ No (e.g. service.ts, types.ts) → MUST rename, add a business word
└─ Yes (e.g. legal-documents.service.ts)
   └─ Prefix equals the module directory name?
      ├─ Yes → Replace with a more specific responsibility word
      └─ No (e.g. documents.service.ts) → Already optimal, do not change
```

## Barrel Exports Rules

- Every sub-directory inside a module (`services/`, `dto/`, `tools/`, `providers/`, `strategies/`,
  `guards/`, `decorators/`, `types/`, `constants/`, `cache/`, `adapters/`, `agent/`, `dashboard/`,
  etc.) **must** contain an `index.ts` that re-exports all public symbols from that directory.
- A barrel file contains **only** `export *` statements — no logic, no imports for side-effects.
- Cross-module imports must go through the barrel, not deep file paths:
  - ❌ `import { XxxService } from '../auth/services/auth-token.service';`
  - ✅ `import { XxxService } from '../auth/services';`
- `@Module()` `exports` arrays still control DI visibility; barrels only affect TypeScript import
  paths.
- `dto/` barrels re-export DTOs only — they never define DTOs inline.

## Module Subdirectory Whitelist

Every module directory must only contain the following subdirectories. New directories outside this whitelist require explicit justification.

### Standard (always allowed)

- `controllers/` — optional; in practice the main controller lives at the module root
- `services/` — service files; when files exceed 8 and span 2+ domains, split into domain sub-directories
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
- `utils/` — pure helper functions scoped to the module; not a home for injectable services
- `agent/` — AI agent runtime (assistant only)
- `dashboard/` — dashboard sub-services (reports only)
- `tools/` — AI tool implementations (assistant only)

### Special

- `migrations/` — Prisma migrations (root-level only)
- `config/` — global configuration at root level; module-level `config/` is allowed only for runtime configuration objects/classes (not for constants, themes, or static helpers)
- `common/` — shared utilities, decorators, interceptors (root-level only)
- `prisma/` — Prisma service and schema (root-level only)
- `i18n/` — translation files (root-level only)

## Root `common/` Conventions

- **No scattered files at the `common/` root** — every file must live inside a role-based
  sub-directory.
- Do not recreate a catch-all `src/common/utils/` directory.
- Prefer role-based shared subdirectories under `src/common/`:
  - `api/` — API envelope, SSE, stream helpers
  - `helpers/` — pure helper functions and stateless shared utilities
  - `services/` — shared injectable services
  - `logger/` — shared Nest logging module
  - `ai/` — shared AI services (safety policy, base generators, LLM runtime port)
  - existing capability folders such as `filters/`, `interceptors/`, `middleware/`,
    `constants/`, `validators/`
- If a file needs Nest DI (`@Injectable()`, module wiring, env-based runtime assembly), it should
  not live in `helpers/`.
- Every sub-directory under `common/` must have an `index.ts` barrel.

## Module Export Rules

- A service should be exported from its module (`exports` array in `@Module`) **iff** another module directly imports and uses it.
- Mapper services follow the naming convention `mapper.service.ts` (placed in the module's `services/` directory; no module-name prefix).
- Ownership services (for record/medicine checks) follow the naming convention `ownership.service.ts` and are placed in the owning module's `services/` directory.
