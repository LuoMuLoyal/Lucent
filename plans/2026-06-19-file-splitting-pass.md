# Lucent File Splitting Pass

## Goal

Reduce oversized hand-written backend files toward these thresholds:

- around 300 lines: preferred
- 300-600 lines: acceptable
- 600+ lines: should be split unless the file is generated or has a strong structural reason

This plan is only for hand-written source under `src/`. Generated Prisma files are tracked separately and are not manual split targets.

## Assumptions

- Generated files under `src/generated/prisma/` should not be hand-edited.
- Spec files count too. Some large specs may remain above 300 temporarily, but they should be split when they start covering multiple behaviors or modules.
- We should prefer extracting cohesive collaborators over creating one more giant `helpers.ts`.

## Current Scan Summary

Hand-written files at or above 600 lines:

- `src/modules/assistant/tools/assistant-tool.service.ts` — 2051
- `src/modules/auth/auth.service.spec.ts` — 1219
- `src/modules/user-health-context/user-health-context.service.spec.ts` — 1037
- `src/modules/assistant/assistant.service.spec.ts` — 958
- `src/modules/auth/auth.service.ts` — 801
- `src/modules/data-export/report-export-pdf.service.ts` — 659

Hand-written files in the 300-600 range that should be kept under control:

- `src/modules/daily-records/daily-records.service.spec.ts` — 459
- `src/modules/assistant/agent/assistant-runtime.graph.ts` — 448
- `src/admin/adminjs.setup.ts` — 442
- `src/modules/reports/services/reports-ai-summary.service.spec.ts` — 412
- `src/modules/assistant/assistant.controller.spec.ts` — 406
- `src/modules/data-export/data-export.service.spec.ts` — 358
- `src/modules/user-health-context/user-health-context.service.ts` — 351
- `src/modules/user/user.service.spec.ts` — 346
- `src/modules/today-analysis/services/today-analysis-context.service.ts` — 341
- `src/modules/user-health-context/dto/health-context-response.dto.ts` — 341
- `src/modules/today-analysis/services/today-analysis.service.spec.ts` — 337
- `src/modules/assistant/tools/assistant-tool.service.spec.ts` — 313
- `src/modules/assistant/assistant-conversation.service.ts` — 310

Generated files above threshold but not manual split targets:

- everything under `src/generated/prisma/`

These should be handled, if needed, by generation strategy changes rather than hand splitting.

## Primary Split Targets

### 1. `src/modules/assistant/tools/assistant-tool.service.ts`

Problem:

- mixes tool dispatch, read tool implementations, proposal generation, matching heuristics, date parsing, record ranking, preview formatting, locale strings, and generic envelope builders

Target outcome:

- keep one orchestration service around 200-350 lines
- move tool-family logic into focused collaborators

Suggested structure:

```text
src/modules/assistant/tools/
  assistant-tool.service.ts
  assistant-tool.types.ts
  assistant-tool.constants.ts
  assistant-tool-read.service.ts
  assistant-tool-proposal.service.ts
  assistant-tool-date-resolver.ts
  assistant-tool-record-matcher.ts
  assistant-tool-presenters.ts
  assistant-tool-envelope.ts
```

Split plan:

- `assistant-tool.service.ts`
  - keep dependency wiring
  - keep `executeMany` / `executeOne`
  - delegate each tool family
- `assistant-tool-read.service.ts`
  - `get_*` read implementations
  - history/profile/settings/medicines/sleep reads
- `assistant-tool-proposal.service.ts`
  - `propose_*` generation
  - create/update/delete/settings proposal assembly
- `assistant-tool-date-resolver.ts`
  - single-date parsing
  - range parsing
  - report-range resolution
- `assistant-tool-record-matcher.ts`
  - mutation hints
  - candidate ranking
  - safe target matching
- `assistant-tool-presenters.ts`
  - preview fields
  - localized summary strings
  - target labels
- `assistant-tool-envelope.ts`
  - read envelope creation
  - coverage/confidence helpers
- `assistant-tool.constants.ts`
  - range/proposal/history constants

Notes:

- avoid a purely static utility dump; prefer injectable services only where dependencies are real
- keep dangerous mutation-target matching isolated and easy to unit test

### 2. `src/modules/auth/auth.service.ts`

Problem:

- one service owns password auth, refresh/logout, verification code flows, email changes, account deletion, OAuth authorize URL generation, OAuth callback validation, OAuth login/link, token issuance, and login rate limiting

Suggested structure:

```text
src/modules/auth/
  auth.service.ts
  services/
    auth-credential.service.ts
    auth-token.service.ts
    auth-oauth.service.ts
    auth-oauth-state.service.ts
    auth-rate-limit.service.ts
```

Split plan:

- `auth.service.ts`
  - keep the public facade used by controller
- `auth-credential.service.ts`
  - register/login/password/email/delete account flows
  - verification code coordination
- `auth-token.service.ts`
  - token pair generation
  - refresh token hashing/session writes
- `auth-oauth.service.ts`
  - web/mobile oauth login and linking flows
- `auth-oauth-state.service.ts`
  - state creation/consume/peek
  - callback uri validation
- `auth-rate-limit.service.ts`
  - failure bucket read/write/clear

### 3. `src/modules/data-export/report-export-pdf.service.ts`

Problem:

- one file mixes document orchestration, page layout, drawing primitives, palette/label logic, wrapping, and kind-specific composition

Suggested structure:

```text
src/modules/data-export/pdf/
  report-export-pdf.service.ts
  report-pdf.constants.ts
  report-pdf.types.ts
  report-pdf.canvas.ts
  report-pdf.sections.ts
  report-pdf.theme.ts
```

Split plan:

- orchestrator service keeps `buildHospitalPdf` / `buildMonthlyPdf` / `buildPrintPdf`
- `report-pdf.canvas.ts`
  - page context
  - page break handling
  - wrapped text and primitive drawing
- `report-pdf.sections.ts`
  - score card / metric card / insight block section renderers
- `report-pdf.theme.ts`
  - labels, palettes, kind-specific copy
- `report-pdf.constants.ts`
  - page sizes and spacing constants

## Spec Split Targets

These should be split by behavior, not by arbitrary line count.

### `src/modules/auth/auth.service.spec.ts`

Split into:

```text
src/modules/auth/
  auth.service.credentials.spec.ts
  auth.service.tokens.spec.ts
  auth.service.oauth.spec.ts
  auth.service.rate-limit.spec.ts
```

### `src/modules/user-health-context/user-health-context.service.spec.ts`

Split by domain slice:

- profile
- conditions/allergies
- medicines
- snapshot/summary transforms

### `src/modules/assistant/assistant.service.spec.ts`

Split into:

- capabilities/memory gating
- send/stream orchestration
- tool execution/proposal flows
- conversation restoration/history handling

## Secondary Refactor Candidates

These are not immediate emergencies, but should not keep growing.

### `src/modules/assistant/agent/assistant-runtime.graph.ts`

Current issue:

- keyword tables plus selection logic are living together

Suggested split:

```text
src/modules/assistant/agent/
  assistant-runtime.graph.ts
  assistant-runtime.tool-rules.ts
  assistant-runtime.tool-selector.ts
```

### `src/modules/user-health-context/user-health-context.service.ts`

Suggested split:

- move snapshot-building / response-mapping into dedicated mapper modules before the service grows further

### `src/admin/adminjs.setup.ts`

Suggested split:

- resource registration
- auth/session config
- dashboard/component config

## Generated File Policy

Files under `src/generated/prisma/` are outside this manual split pass.

If their size becomes a real maintenance problem, the fix should come from:

- generation output configuration
- import boundary changes
- wrapper modules that expose narrower local APIs

Not from editing generated files directly.

## Execution Order

1. Split `assistant-tool.service.ts`
2. Split `auth.service.ts`
3. Split `report-export-pdf.service.ts`
4. Split the three oversized spec files
5. Clean up secondary 300-600 files if they still trend upward

## Validation

For each split step:

- `pnpm test -- --runInBand <touched spec files>`
- `pnpm typecheck`

After backend split pass milestones:

- `pnpm test:ci`
- `pnpm export:openapi` if public contract code is affected

## Expected Observable Outcome

- no hand-written backend source file above 600 lines without an explicit justification
- most orchestration files reduced near 300-450 lines
- module directories reflect domain responsibilities instead of one-file accumulation
