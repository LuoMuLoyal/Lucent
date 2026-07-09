# Toolchain / Contract

Last updated: 2026-07-09 (pre-commit doc-check .ts + default blocking)

- Local backend toolchain baseline is Node.js `24.x` plus pnpm `11.x`; CI and Corepack docs pin the
  recommended baseline to `11.9.0`.
- local `docs/openapi.json` remains the exported backend contract artifact that Luminous
  regenerates its `generated/lucent_api/` client from.
- The current exported contract now includes meal-analysis read hot fields on `DailyRecordItemDto`:
  status, coverage, updated-at, failure-reason, short-description, and top-foods.
- Lucent CI now re-exports `docs/openapi.json` as a local build artifact instead of diffing a
  committed generated contract file.
- `pnpm prisma:generate` now also transpiles `generated/prisma/internal/*.ts` to `.js`, because
  Prisma 7's custom-output client currently leaves those runtime files missing while `client.js`
  still requires them for `pnpm build`, `pnpm export:openapi`, and other compiled-runtime flows.
- `package.json` now includes a `postinstall` hook that runs `pnpm prisma:generate`, ensuring the
  Prisma client (with the `.js` fix) is always generated after `pnpm install`. The `export:openapi`
  script also depends on `pnpm prisma:generate` as a belt-and-suspenders safeguard.
- Lucent CI PostgreSQL now runs on `pgvector/pgvector:pg18`, matching the documented
  extension-capable local baseline instead of validating against plain Postgres.
- `pnpm typecheck:tools` now type-checks `scripts/` and `deploy/` under the same decorator-capable
  baseline as the Nest app, so tool imports of Nest services no longer fail on stripped decorator
  settings.
- Lucent runtime, Prisma CLI, and local import scripts now parse environment variables in a unified
  priority order: `.env.<NODE_ENV>.local` → `.env.<NODE_ENV>`, with no root `.env` fallback.
- OpenAPI contract fully fixed: all `nullable: true` DTO fields now have explicit `type` annotations,
  eliminating the P0 crash (`int.toJson is not a function`) and P1 type loss (`dynamic`) in the
  Flutter generated client. SSE stream endpoints have `text/event-stream` content annotations, and
  the `/clear` endpoint has a named response DTO.
- Pre-commit hook (`simple-git-hooks`) now runs `scripts/hooks/check-docs-updated.ts` before
  `pnpm lint-staged`. The script blocks commits that stage `src/**/*.ts` source files (excluding
  specs / generated / test) without a corresponding doc update (migration log under
  `docs/02-logs/migration-log/` or any file under `docs/00-current/`). Bypass with
  `SKIP_DOC_CHECK=1` or `--no-verify`.
