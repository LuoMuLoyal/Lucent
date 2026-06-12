# Lucent TODO

Last updated: 2026-06-12

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to one branch or security check, but do not scatter project-level follow-up lists across changelogs or random docs.

## AI / LLM Runtime

- Audit Lucent for remaining user-visible AI hardcoded copy outside the Today analysis i18n path.
- Define one shared locale-aware prompt/copy helper for future weekly summary, monthly summary, candidate-record NLP, and screenshot-analysis modules.
- Keep AI feature boundaries explicit:
  - business use-case service owns auth/settings gate, data aggregation, policy fallback, and response shaping
  - copy service owns locale normalization plus localized prompt/fallback copy
  - generator service owns one feature-specific LLM invocation shape
  - `llm-runtime` owns provider/model construction only
- Decide the execution boundary for future AI workflows:
  - keep bounded linear pipelines for single-purpose flows
  - introduce a tool-capable orchestrator only when branching, retrieval, or multi-step tool use becomes real

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

- Remove code-level fallback JWT/admin secrets and move dev defaults to env templates only.
- Align `testing-support` password hashing with the shared `ARGON2_OPTIONS`.
