# Lucent Docs

Last updated: 2026-06-25

This directory keeps the authoritative backend runtime, deployment, generated-contract, and shared data-contract documentation for Lucent. If a complex backend task needs a live execution plan, put it under `../plans/` instead of `docs/`.

## Document Boundaries

| Document                           | Responsibility                                                                       | Do not put here                       |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| `environment.md`                   | Runtime config, local stacks, required variables, command behavior                   | Tencent Cloud step-by-step deployment |
| `deployment.md`                    | Single-source production deployment runbook, directory layout, and checks            | General env variable explanations     |
| `openapi.json`                     | Generated API contract from `pnpm export:openapi`                                    | Manual edits                          |
| `public/data-sources.md`           | Medicine source/import strategy and table mapping                                    | Product roadmap                       |
| `public/reminder-contract.md`      | Reminder/notification backend-vs-device boundary                                     | UI implementation details             |
| `public/environment-contract.md`   | Environment snapshot API boundary                                                    | More-tab or generic utility plans     |
| `public/mine-settings-contract.md` | Mine/Settings API boundary (user settings, support resources, app info, data export) | UI implementation details             |
| `public/assistant-contract.md`     | Assistant capability/permission boundary and rollout truth                           | Prompt drafts or temporary plans      |
| `TODO.md`                          | Active deferred backend follow-up items                                              | Historical changelog narrative        |

Product direction and current product state are owned by the workspace path `Luminous/docs/`.

## Update Map

| Change                                                         | Update                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| Environment variables, local Docker, scripts, runtime baseline | `environment.md` and root `README.md`                       |
| Production deployment procedure or server directory layout     | `deployment.md`                                             |
| Production deploy asset layout under repo `deploy/`            | `deployment.md` and root `README.md`                        |
| Medicine import behavior or source-table strategy              | `public/data-sources.md`                                    |
| Reminder schedule/preference contract                          | `public/reminder-contract.md`                               |
| Environment snapshot contract                                  | `public/environment-contract.md`                            |
| Mine/Settings contract                                         | `public/mine-settings-contract.md`                          |
| Assistant capability / permission contract                     | `public/assistant-contract.md`                              |
| Deferred backend follow-up list                                | `TODO.md`                                                   |
| Lucent API code                                                | Run `pnpm export:openapi` and keep `openapi.json` generated |

## Relationship With `Lumos-docs`

`Lumos-docs/` is a separate showcase documentation site. It mirrors content from `Lucent/docs/` and `Luminous/docs/` for browsing convenience, but it **is not the source of truth** and is updated more slowly than the repo docs.

- Treat `Lucent/docs/` and `Luminous/docs/` inside each repo as the authoritative reference.
- Do not edit `Lumos-docs/` copies by hand to keep them "in sync"; the site should consume repo docs through its build pipeline.
- If you find a discrepancy, trust the repo-local doc and open a site ingestion issue instead of patching the mirror.

## Rules

- Do not maintain hand-written endpoint docs or API mock documents.
- Do not edit `openapi.json` manually.
- Active repo-local execution plans belong in `Lucent/plans/`; move durable decisions into the owning docs after completion, then delete the plan file.
- Keep old implementation plans out of active docs after their decisions move into the owning document.
- **When a follow-up item in `TODO.md` is completed, delete it from `TODO.md`; do not mark it complete there.** Move the resulting current-state facts to `Luminous/docs/Current_State.md` and record the change in the daily `Luminous/docs/migration-log/YYYY-MM-DD.md`.
- Repo helper scripts under `scripts/` and `deploy/` are not part of the Nest app ESLint surface; validate them by running the relevant command instead of forcing app-only lint rules onto opened tool files.
