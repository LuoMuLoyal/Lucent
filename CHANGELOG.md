# Lucent Changelog

Last updated: 2026-06-08

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
