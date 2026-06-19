# Lucent TODO

Last updated: 2026-06-18

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to one branch or security check, but do not scatter project-level follow-up lists across changelogs or random docs.

## AI / LLM Runtime

- ~~Audit Lucent for remaining user-visible AI hardcoded copy outside the Today analysis i18n path.~~ Done 2026-06-12: `reports-presenter.service.ts` was the only gap; findings/patterns/score-summary now go through `reports-dashboard.*` i18n keys, and `getDashboard` passes `@I18nLang()` locale through the service chain.
- ✅ AI boundary confirmed (2026-07-01): see `plans/2026-07-01-ai-boundary-confirmation.md`
  - Monthly report → bounded linear (same as Today/Report weekly)
  - Agent (LangGraph) restricted to Assistant; do not retro-fit bounded flows
  - Shared `StructuredAnalysisGenerator<T>` extraction deferred until monthly report proves the pattern
  - Four-layer boundary confirmed: business-use-case → copy → generator → llm-runtime
- Assistant phase 1 now uses a restricted LangGraph foundation:
  - keep tool availability enforced server-side
  - keep latest-conversation persistence intentionally narrow before expanding to multi-conversation management
  - keep leaflet RAG / pgvector deferred until the base assistant contract is stable

## Module Boundaries

- Split `src/modules/user-health-context/user-health-context.service.ts` further if the write-side keeps growing.
  Current status: response mapping and ownership guards are now separated, but profile/allergy/condition/current-medicine write normalization still lives in one orchestration service.

## Report Export

- Extend report export into:
  - optional async worker execution instead of request-thread generation
  - richer structured sections or chart blocks if doctor-facing readability needs more than the current text-first PDF template

## Auth / Security

- Add optional 2FA challenge verification before issuing tokens.
  Source context: `src/modules/auth/auth.service.ts`
- Expose device/session management so users can review and revoke individual sessions.
  Source context: `src/modules/auth/auth.service.ts`
- Add a dedicated set-password flow for OAuth-only accounts.
  Source context: `src/modules/auth/auth.service.ts`
- Allow OAuth-only accounts to delete only after a fresh linked-identity verification.
  Source context: `src/modules/auth/auth.service.ts`
- Emit security notifications for new OAuth logins and newly linked identities.
  Source context: `src/modules/auth/auth.service.ts`
- Add more OAuth providers such as Apple or Google when product scope requires them.
  Source context: `src/modules/auth/oauth.types.ts`

## Config / Hardening

- JWT/admin secrets now come from env files only.
- `testing-support` now reuses the shared `ARGON2_OPTIONS`.
