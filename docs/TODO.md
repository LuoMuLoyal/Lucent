# Lucent TODO

Last updated: 2026-06-25

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to one branch or security check, but do not scatter project-level follow-up lists across changelogs or random docs.

## Module Boundaries

- Split `src/modules/user-health-context/user-health-context.service.ts` further if the write-side keeps growing.
  Current status: profile write is now separated into `UserHealthContextProfileWriteService`, but allergy/condition/current-medicine write normalization still lives in the main orchestration service.

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
