# Migration Log - 2026-06-12

## AI Runtime Extraction + TODO Triage

- Extracted OpenAI-compatible model/runtime creation out of `today-analysis.service.ts` into a
  dedicated `LlmRuntimeModule` / `LlmRuntimeService`.
- `TodayAnalysisService` now owns Today-specific business logic only: auth/settings gate, context
  aggregation, prompt assembly, safety fallback, and response shaping.
- Deferred remaining AI/i18n cleanup to `docs/00-current/TODO.md` instead of expanding this
  core-business refactor.

## Report Contract Closeout Review

- Confirmed the new `Reports` module and exported OpenAPI contract are in place for the Luminous
  report dashboard.
- Reviewed an external audit list and filtered out false positives instead of importing it
  wholesale.
- Confirmed these items are still real but intentionally deferred from this report closeout:
  - code-level fallback secrets still exist in `src/config/jwt.config.ts` and
    `src/config/environment.validation.ts`; dev defaults should eventually move to env templates
    only
  - `src/modules/testing-support/testing-support.service.ts` hashes test-lane passwords without the
    shared `ARGON2_OPTIONS`
  - CI workflow uses explicit local/test database credentials in
    `.github/workflows/deploy-server.yml`; acceptable for current ephemeral CI services, but still
    a future hardening candidate if the workflow shape changes
- Confirmed these external-review claims are not current blockers for this closeout:
  - "8/14 modules have no controller spec" is directionally true as a coverage observation, but not
    a release blocker by itself
  - the newly added report contract already has controller and service specs, so this closeout did
    not leave the report module untested
