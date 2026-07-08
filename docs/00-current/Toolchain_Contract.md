# Toolchain / Contract

Last updated: 2026-07-08

- Local backend toolchain baseline is Node.js `24.x` plus pnpm `11.x`; CI and Corepack docs pin the
  recommended baseline to `11.9.0`.
- `docs/openapi.json` remains the exported backend contract artifact that Luminous regenerates its
  `packages/lucent_openapi/` client from.
- The current exported contract now includes meal-analysis read hot fields on `DailyRecordItemDto`:
  status, coverage, updated-at, failure-reason, short-description, and top-foods.
- Lucent CI now re-exports `docs/openapi.json` and fails if the committed contract artifact drifts
  from current backend code.
- The OpenAPI committed-artifact gate is now semantic JSON comparison rather than raw text diff, so
  formatting-only reflow in `docs/openapi.json` does not block unit/e2e stages.
- `pnpm prisma:generate` now also transpiles `generated/prisma/internal/*.ts` to `.js`, because
  Prisma 7's custom-output client currently leaves those runtime files missing while `client.js`
  still requires them for `pnpm build`, `pnpm export:openapi`, and other compiled-runtime flows.
- Lucent CI PostgreSQL now runs on `pgvector/pgvector:pg18`, matching the documented
  extension-capable local baseline instead of validating against plain Postgres.
- `pnpm typecheck:tools` now type-checks `scripts/` and `deploy/` under the same decorator-capable
  baseline as the Nest app, so tool imports of Nest services no longer fail on stripped decorator
  settings.
