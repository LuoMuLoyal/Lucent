# AGENTS.md - Lucent

## Read First

- `README.md`
- `docs/README.md`
- `docs/environment.md`
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
- Active multi-step backend task plans belong in `plans/*.md`, not in `docs/` and not in the workspace root.
- Env, Docker, import flow, or local commands changed: update `docs/environment.md` and `README.md`.
- Medicine import or source strategy changed: update `docs/public/data-sources.md`.
- For localized backend copy, keep `AcceptLanguageResolver + I18nService` as the default path. Use `@I18nLang()` only when a controller/service flow must explicitly branch on the resolved locale and pass that locale deeper into AI/prompt/runtime code.
- Fix the requested problem directly; do not loosen TS/ESLint rules or refactor nearby working code.
- Use `pnpm typecheck` when you need TypeScript to validate spec and e2e files too; `pnpm build` excludes `**/*spec.ts` and `test/`.

## Known Gotchas

- NestJS 11 cache module expects `stores`, not legacy `store`. If Redis is enabled, wrap the Redis store as a Keyv-backed store or the cache manager may silently fall back to memory semantics.
- `cache-manager` / Nest cache TTL is in milliseconds in this repo.
- DrugBank `full database.xml` is about 1.9 GB unzipped and contains nested structures; keep it on the scripted XML -> normalized tables path. Do not convert it to `xlsx` for routine import.
- Prisma 7 client provider is `prisma-client`, not `prisma-client-js`.
- Prisma output paths resolve relative to `schema.prisma`.
- Prefer native command flags such as `pnpm --prefix` and `git -C`.
- Empty NestJS modules may need a narrow eslint disable for `no-extraneous-class`.
