# Lucent Module Layout Plan

Date: 2026-06-05

## Goal

Normalize Lucent backend structure after auth/mail rate-limit work:

- Use a dedicated package for client IP extraction in auth verification-code rate limiting.
- Move business feature modules under `src/modules/`.
- Keep infrastructure/runtime support under top-level `src/`.
- Split large DTO files so DTO organization is consistent across modules.

## Assumptions

- `src/modules/` is the feature-module root. `src/module/` is avoided because it contains multiple modules.
- Business modules to move: `auth`, `user`, `user-health-context`, `daily-records`, `medicine-dose-logs`, `medicines`.
- Top-level modules to keep: `common`, `config`, `generated`, `i18n`, `mail`, `prisma`, plus `app.*`, `main.ts`, `setup-app.ts`.
- DTO split should be narrow: split only large multi-purpose DTO files, keep already-split auth/user-health-context DTOs as-is.
- OpenAPI schema names should remain stable where classes keep the same names.

## Affected Files

- `src/app.module.ts`
- moved feature directories under `src/modules/`
- imports in moved feature modules, tests, and e2e specs
- DTO barrel files under moved feature modules
- `package.json` / `pnpm-lock.yaml` for IP package
- docs and generated OpenAPI if route metadata or imports change

## Milestones

1. Add and use `request-ip` for client key extraction.
2. Move business modules to `src/modules/` and update imports.
3. Split large DTO files:
   - medicines query/constants/results/response DTOs
   - daily-record write/query/item/response DTOs
   - medicine-dose-log create/update DTOs
4. Update docs for layout and changelog.
5. Verify install, lint, build, focused unit/e2e, OpenAPI export, and diff hygiene.

## Expected Observable Results

- `src/` no longer has business module folders at the top level.
- `src/modules/` contains all business feature modules.
- Auth verification-code rate limiting obtains IP through `request-ip`.
- Existing endpoint paths remain unchanged.
- OpenAPI path/schema counts should remain stable unless the DTO split changes schema discovery.

## Result

- Completed on 2026-06-05.
- Business modules moved to `src/modules/`; top-level `src/` keeps infrastructure/runtime support.
- Client IP extraction moved to `src/common/request/client-ip.ts` using `request-ip`.
- Oversized DTO files split for medicines, daily-records, and medicine-dose-logs while preserving DTO class names.
- OpenAPI export stayed at 27 paths / 76 schemas.

## Verification

- `pnpm install --frozen-lockfile` — passed.
- `pnpm lint:check` — passed.
- `pnpm build` — passed.
- `pnpm test:ci` — 15 suites / 125 tests passed.
- `pnpm test:e2e:ci` — 6 suites / 72 tests passed.
- `pnpm export:openapi` — passed, 27 paths / 76 schemas.
- `git diff --check` — passed.
