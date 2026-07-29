# Lucent Claude Entry

`AGENTS.md` is the authoritative source of project rules. This file is a Claude-focused
quick reference — read `AGENTS.md` first for the full rules.

## Read First

1. `AGENTS.md`
2. `README.md`
3. `CONTRIBUTING.md`
4. `docs/README.md`
5. `docs/01-reference/environment.md`, `environment-variables.md`, `architecture.md`
6. `docs/01-reference/adr/` for architecture decisions

## Stack

NestJS 11, Prisma 7, PostgreSQL, Redis, JWT auth (WeChat / Apple / QQ OAuth).
BullMQ for async jobs. AdminJS panel at `/admin`. API docs UI at `/api/docs` via Scalar.

## Current Baseline

- Dev DB: `postgres/postgres@127.0.0.1:15432/lucent`.
- Test DB: `lucent/lucent_dev@127.0.0.1:5432/lucent`.
- Redis: `redis://127.0.0.1:6379`.
- Response envelope: `{ code, message, data }`. Health check: `GET /api/v1/health`.

## Common Commands

```bash
pnpm install
pnpm dev:stack:up        # local PostgreSQL + Redis
pnpm db:migrate:all      # migrate dev + test DBs
pnpm start:dev           # watch mode
pnpm lint:check          # eslint, --max-warnings=0, generated/ ignored
pnpm format:check        # prettier check
pnpm typecheck           # tsc --noEmit (includes spec/e2e)
pnpm build               # nest build (excludes **/*spec.ts and test/)
pnpm test:ci             # unit tests (vitest --runInBand)
pnpm test:e2e:ci         # e2e tests
pnpm export:openapi      # regenerate docs/openapi.json after API changes
pnpm docs:check          # after EVERY code change
pnpm docs:compodoc       # after architecture/module structure changes
```

Run a single test: `pnpm test -- path/to/file.spec.ts` or
`pnpm test -- -t "name"`.

While iterating use the narrow command; run `pnpm lint:check` + `pnpm build` +
`pnpm test:ci` before finishing.

## Documentation Rules (Non-Negotiable)

After **every** code change, run:

```bash
pnpm docs:check
```

It reads `docs/doc-map.yaml` and prints a per-rule report of which docs each touched
code area expects. The pre-commit hook runs the same tool in **blocking** mode:
`src/**/*.ts` staged but no `docs/` file staged → commit blocked. Bypass with
`SKIP_DOC_CHECK=1`.

### Standing rules

- **Migration log**: append a dated entry to `docs/02-logs/migration-log/YYYY-MM-DD.md`.
- **Current state**: runtime/architecture changes go into the relevant
  `docs/00-current/*.md` sub-file, not into `Current_State.md` (index only).
- **Env/Docker/import/commands**: sync `docs/01-reference/environment.md`,
  `environment-variables.md`, and `README.md`.
- **Closing a TODO**: delete the line from `docs/00-current/TODO.md`.
- **Finishing a plan**: delete the entire section from `plans/*.md`.
- Completed items are **deleted** outright — no `✅`, `DONE`, strikethrough, or any
  other marker.

## Working Rules

- API contract changed → `pnpm export:openapi` then commit `docs/openapi.json`. Do not hand-write endpoint docs.
- Architecture/module structure changed → `pnpm docs:compodoc`.
- Medicine import strategy changed → update `data-sources.md` + relevant source file.
- Significant architectural decision → create ADR in `docs/01-reference/adr/NNNN-title.md`.
- Localized backend copy: `AcceptLanguageResolver + I18nService` by default;
  `@I18nLang()` only when branching on locale for AI/prompt code.
- Fix the requested problem directly; do not loosen TS/ESLint rules or refactor nearby
  code.
- `pnpm typecheck` validates spec/e2e files too; `pnpm build` excludes `**/*spec.ts`
  and `test/`.

## Architecture

- `src/modules/` — feature modules (auth, account, user, daily-records,
  medicine-dose-logs, medicine-reminders, medicines, environment, etc.). Each is a
  standard Nest module (controller + service + DTOs).
- `src/` top level — bootstrap and infrastructure: `app.module.ts`, `main.ts`,
  `setup-app.ts`, plus `common`, `config`, `generated`, `i18n`, `mail`, `prisma`,
  `admin` (embedded AdminJS panel at `/admin`).
- Database model lives in `prisma/schema.prisma`; runtime config in
  `docs/01-reference/environment.md`.
- Medicine knowledge is imported via `scripts/medicine/` (driven by `import:*` package
  scripts).

### Backend gotchas

- Prisma 7: client provider is `prisma-client` (not `prisma-client-js`); output paths
  resolve relative to `schema.prisma`.
- NestJS 11 cache module expects `stores` (plural), not legacy `store`; wrap Redis as
  a Keyv-backed store or it silently falls back to memory. Cache/TTL values are in
  **milliseconds**.
- Empty Nest modules may need a narrow eslint disable for `no-extraneous-class`.

## File Naming Rules

**Core principle**: File name = responsibility, not location. Directory = namespace,
file name = WHAT it does.

- NestJS framework suffixes (`.service.ts`, `.controller.ts`, `.module.ts`, `.dto.ts`)
  **stay** — they are CLI-generated and expected by the framework.
- No module-name prefix on files inside the module.
  - ❌ `legal-documents/services/legal-documents.service.ts` → ✅ `documents.service.ts`
- Never use a bare type word (`service.ts`, `types.ts`). Add a business word.
- Class names are unaffected — NestJS DI resolves by class name, not file name.
- See `AGENTS.md` for the full 8-rule list.

## Barrel Exports

- Each module has a single `index.ts` at the module root that explicitly exports
  the module's public API — use `export { X } from './path'`, never `export *`.
- No sub-directory barrels (`services/index.ts`, `dto/index.ts`, etc.) —
  sub-directories are internal namespaces, not export surfaces.
- Cross-module imports go through the module root barrel:
  - ❌ `import { XxxService } from '../auth/services/auth-token.service';`
  - ✅ `import { XxxService } from '../auth';`
- Within a module, use deep-path imports:
  - ❌ `import { XxxService } from './services';`
  - ✅ `import { XxxService } from './services/account.service';`

## Cross-Project Contract

The single source of truth for the API is **Lucent controller/DTO code +
`docs/openapi.json`**. When Lucent API code changes:

1. In `Lucent`: `pnpm export:openapi` (this builds first, then regenerates
   `docs/openapi.json`), then commit the file.
2. In `Luminous`: `cd generated/lucent_api && dart run build_runner build` — this
   regenerates `generated/lucent_api`.

Do not hand-maintain endpoint prose as the source of truth.

## Non-Negotiable Boundaries

- Do not hardcode API keys, OAuth secrets, database URLs with real credentials, cloud
  credentials, cookies, or private keys.
- Fix the requested problem directly — do not loosen TS/ESLint rules or refactor nearby
  working code.
- Do not touch unrelated dirty or untracked files in sibling projects.
- Ask before destructive commands, force-pushes, production deploys, credential
  changes, or broad cross-project migrations.
