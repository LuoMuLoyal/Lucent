# Report Export PDF Plan

Last updated: 2026-06-15

## Goal

Implement the first real Lucent report export flow:

- authenticated user requests a report export
- Lucent generates a PDF from existing report aggregates
- Lucent uploads the PDF to Tencent COS
- Lucent stores export metadata and returns a short-lived download URL through the latest-status endpoint

## Scope

First slice only:

- export kind: `hospital`
- export format: `pdf`
- report range: `last_7_days`

Out of scope for this slice:

- monthly/print variants
- frontend wiring in Luminous
- desktop-specific UI
- background worker queueing
- editable docx export

## Assumptions

- Existing report dashboard aggregation is the source of truth for the export payload.
- Existing Tencent COS credentials can be reused for generated report files.
- A synchronous request path is acceptable for the first slice as long as status is persisted correctly.

## Expected File Touches

- `prisma/schema.prisma`
- `src/modules/data-export/**`
- `src/modules/reports/**` for shared data access if needed
- `src/config/**` if export-specific env validation is needed
- `docs/environment.md`
- `docs/public/mine-settings-contract.md`
- `docs/TODO.md` if follow-ups remain

## Milestones

1. Extend export persistence model and API DTOs with real export metadata.
2. Add a COS-backed file runtime for upload plus signed download URLs.
3. Generate a simple hospital PDF from current report aggregates.
4. Persist success/failure state and expose the latest result through API.
5. Verify with typecheck, lint, targeted tests, and OpenAPI export.

## Verification

- `pnpm typecheck`
- `pnpm lint:check`
- targeted `jest` for `src/modules/data-export/**`
- `pnpm export:openapi`

## Observable Success

- `POST /api/v1/user/data-export-requests` returns a real export row with kind/format/range metadata.
- The export row reaches `completed` when COS is configured and the PDF upload succeeds.
- `GET /api/v1/user/data-export-requests/latest` returns a usable short-lived download URL for the completed export.
