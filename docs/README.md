# Lucent Docs

Last updated: 2026-06-08

This directory keeps backend runtime, deployment, generated-contract, and shared data-contract documentation for Lucent. If a complex backend task needs a live execution plan, put it under `../plans/` instead of `docs/`.

## Document Boundaries

| Document                           | Responsibility                                                                       | Do not put here                       |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| `environment.md`                   | Runtime config, local stacks, required variables, command behavior                   | Tencent Cloud step-by-step deployment |
| `tencent-cloud-cicd.md`            | Tencent CVM/TCR deployment runbook                                                   | General env variable explanations     |
| `openapi.json`                     | Generated API contract from `pnpm export:openapi`                                    | Manual edits                          |
| `public/data-sources.md`           | Medicine source/import strategy and table mapping                                    | Product roadmap                       |
| `public/reminder-contract.md`      | Reminder/notification backend-vs-device boundary                                     | UI implementation details             |
| `public/environment-contract.md`   | Environment snapshot API boundary                                                    | More-tab or generic utility plans     |
| `public/mine-settings-contract.md` | Mine/Settings API boundary (user settings, support resources, app info, data export) | UI implementation details             |
| `TODO.md`                          | Active deferred backend follow-up items                                              | Historical changelog narrative        |

Product direction is owned by workspace path `Luminous/docs/Product_Vision.md`.

## Update Map

| Change                                                         | Update                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| Environment variables, local Docker, scripts, runtime baseline | `environment.md` and root `README.md`                       |
| Tencent Cloud deployment procedure                             | `tencent-cloud-cicd.md`                                     |
| Medicine import behavior or source-table strategy              | `public/data-sources.md`                                    |
| Reminder schedule/preference contract                          | `public/reminder-contract.md`                               |
| Environment snapshot contract                                  | `public/environment-contract.md`                            |
| Mine/Settings contract                                         | `public/mine-settings-contract.md`                          |
| Deferred backend follow-up list                                | `TODO.md`                                                   |
| Lucent API code                                                | Run `pnpm export:openapi` and keep `openapi.json` generated |

## Rules

- Do not maintain hand-written endpoint docs or API mock documents.
- Do not edit `openapi.json` manually.
- Active repo-local execution plans belong in `Lucent/plans/`; move durable decisions into the owning docs after completion, then delete the plan.
- Keep old implementation plans out of active docs after their decisions move into the owning document.
