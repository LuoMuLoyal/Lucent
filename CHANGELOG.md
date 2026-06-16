# Lucent Changelog

Last updated: 2026-06-14

## 2026-06-14

### GitHub Actions Pure Artifact Deployment

- Replaced the old Gitee Go deployment path with GitHub Actions CD plus Tencent TCR image push.
- Removed the server-side git checkout requirement; production now deploys from `/opt/lucent/releases/<git-sha>` and a `/opt/lucent/releases/current` pointer.
- Added remote deploy-asset sync workflow and updated docs/checklists to the new server layout.

### Repo + Runtime Deployment Split

- Switched server deployment to a split layout: tracked app repo at `/opt/lucent/app`, server-local runtime files at `/opt/lucent/runtime`.
- Updated compose and deploy workflow so the server now `git pull --ff-only`, then reads env/certs/Nginx runtime files from `/opt/lucent/runtime`.
- Removed the old template-driven Nginx deploy path and replaced it with a concrete repo baseline config at `deploy/nginx/nginx.conf`.
- Stopped treating monitoring assets as runtime-local files; Prometheus, Grafana provisioning, and synthetic checker assets now stay under tracked repo path `monitoring/**`.

### Deployment Docs Boundary Cleanup

- Added `docs/deployment-checklist.md` for executable deployment and go-live verification steps only.
- Narrowed `docs/tencent-cloud-cicd.md` to Tencent Cloud / TCR workflow setup and deploy-chain behavior only.
- Narrowed `docs/deployment-files.md` to file ownership and directory boundaries only.
- Removed stale Nginx env fields from production env docs and templates so runtime config now reflects the real compose/deploy model.

## 2026-06-12

### AI Runtime Extraction + TODO Triage

- Extracted OpenAI-compatible model/runtime creation out of `today-analysis.service.ts` into a dedicated `LlmRuntimeModule` / `LlmRuntimeService`.
- `TodayAnalysisService` now owns Today-specific business logic only: auth/settings gate, context aggregation, prompt assembly, safety fallback, and response shaping.
- Deferred remaining AI/i18n cleanup to `docs/TODO.md` instead of expanding this core-business refactor.

### Report Contract Closeout Review

- Confirmed the new `Reports` module and exported OpenAPI contract are in place for the Luminous report dashboard.
- Reviewed an external audit list and filtered out false positives instead of importing it wholesale.
- Confirmed these items are still real but intentionally deferred from this report closeout:
  - code-level fallback secrets still exist in `src/config/jwt.config.ts` and `src/config/environment.validation.ts`; dev defaults should eventually move to env templates only
  - `src/modules/testing-support/testing-support.service.ts` hashes test-lane passwords without the shared `ARGON2_OPTIONS`
  - CI workflow uses explicit local/test database credentials in `.github/workflows/deploy-server.yml`; acceptable for current ephemeral CI services, but still a future hardening candidate if the workflow shape changes
- Confirmed these external-review claims are not current blockers for this closeout:
  - "8/14 modules have no controller spec" is directionally true as a coverage observation, but not a release blocker by itself
  - the newly added report contract already has controller and service specs, so this closeout did not leave the report module untested

## 2026-06-08

### Docs Boundary Cleanup

- Removed the stale public product roadmap and public sub-index; product direction now lives in `../Luminous/docs/Product_Vision.md`.
- Reworked `docs/README.md` and `docs/environment.md` so runtime config, deployment runbook, generated API contract, data-source strategy, and shared contracts have separate responsibilities.
- Updated environment snapshot and reminder contracts to match the Product_Vision MVP boundary.

## 2026-06-06

### Auth TODO Triage

- Classified 8 auth TODOs: 2 resolved (OAuth config boot validation via OnModuleInit), 6 remain with owner/reason tags.
- Rewrote remaining TODOs with blocked conditions: 2FA (product decision), session management (feature scope), OAuth-only password (security review), security notifications (notification infra), Apple/Google providers (platform credentials).

### Reminder / Notification Contract

- Created `docs/public/reminder-contract.md` defining the notification/reminder boundary.
- Device-local layer: system permission, preference toggles, local-only notifications.
- Backend-owned layer: reminder schedules, notification preferences, delivery audit log.
- Explicitly excluded: FCM/APNs push delivery, WebSocket, third-party services.

### Environment Snapshot Contract

- Created `docs/public/environment-contract.md` for the first real More module integration.
- API: `GET /api/v1/environment/snapshot` — pollen, UV, air quality, temperature, humidity.
- Initial implementation: static seasonal reference data (no external API keys).

## 2026-06-04

### Health-Context Write Surface Recovery

- Restored the health-context write surface on `dev` branch that had been lost across branch history.
- Regenerated Luminous OpenAPI client (27 paths / 76 schemas).
- Added typed medicine dose-log response schemas, migration, unit/e2e coverage.

## 2026-06-03

### Health Context Profile Upsert Fix

- Fixed upsert completion: `onboardingCompletedAt` now written on both create and update branches.

## 2026-06-02

### Auth Validation + Change Email Alignment

- ValidationPipe error codes mapped to contract (400002).
- ChangeEmail response now returns normalized persisted email.
- Logout constrained to current JWT user.

### I18n Dist Runtime Fix

- Type output restricted to development context to fix dist/test runtime failures.

## 2026-06-01

### CI/CD Pipeline

- Docker build + push pipeline for Tencent Cloud TCR.
- Health-check rollback on deployment failure.

## 2026-05-31

### Medicines Cache Invalidation + OpenAPI Sync

- Cache invalidation normalized for Keyv namespace structure.
- OpenAPI re-exported to sync medicines endpoints.

## 2026-05-30

### Auth Security Baseline

- Login credentials must be exactly one: password or code.
- Soft-deleted users excluded from default queries.
- JWT `sub`/`subject` deduplication.
- E2E baseline: register, login, refresh, logout, me.
- Dual local PostgreSQL setup: dev (15432) + test (5432).

### Medicine Knowledge Foundation

- DrugBank XML import (drugs, links, targets with stable IDs).
- Chinese medicine product import via scripted pipeline.
- Source-aware search/detail APIs.

## 2026-05-28

### OpenAPI + Runtime Fixes

- OpenAPI export pipeline: build → export from dist.
- Prisma v7 adapter configuration.
- Joi v18 URI scheme fixes.
- Docker build: TS strict mode fixes.

## 2026-05-27

### Project Init

- NestJS 11 + Prisma 7 + PostgreSQL + Redis baseline.
- Auth module: register, login, refresh, JWT, WeChat OAuth.
- API envelope contract: `{ code, message, data }`.
