# AGENTS.md - Lucent

## Must Do

- Code behavior changed: update `CHANGELOG.md`.
- API contract changed: update `docs/public/api-contract.md`, plus `docs/auth-api-mock.md` and OpenAPI when needed.
- env / Docker / test command changed: update `docs/environment.md` and `README.md`.
- Product stage changed: update `docs/public/ROADMAP.md`.

## Guardrails

- Read `docs/README.md` before editing docs.
- Do not duplicate current status across docs.
- `docs/auth-implementation-plan.md` and `docs/migration-roadmap.md` are reference only.
- Keep health check under the shared envelope: `{ code, message, data }`.
- Do not loosen TypeScript or ESLint strictness to make code pass.
- Fix the targeted problem; do not refactor adjacent working code.

## Known Gotchas

- Prisma 7 client provider is `prisma-client`, not `prisma-client-js`.
- Prisma output paths resolve relative to `schema.prisma`.
- Prefer native command flags such as `pnpm --prefix` and `git -C`.
- Empty NestJS modules may need a narrow eslint disable for `no-extraneous-class`.
