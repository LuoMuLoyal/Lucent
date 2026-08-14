/**
 * Server-side allowlist of suggestion rule codes accepted for the
 * `suggestionRuleCode` product-event attribute. Mirrors the `ruleId` values
 * registered in today-suggestion's `RegistryService` (each rule service
 * exposes `readonly ruleId`). No free-form strings are ever accepted.
 *
 * MUST stay in sync with the today-suggestion rule registry —
 * `events.service.spec.ts` locks this set against the actual rule service
 * classes, so adding a rule without updating this list breaks the build.
 */
export const SUGGESTION_RULE_CODE_ALLOWLIST: ReadonlySet<string> = new Set([
  'water_behind_target',
  'sleep_shortfall',
  'caffeine_sleep_correlation',
  'mood_sleep_correlation',
  'missed_dose_pending',
  'coverage_explanation',
  'deteriorating_symptom',
]);

/** True when the code is null/absent or present in the server-side allowlist. */
export function isKnownSuggestionRuleCode(
  code: string | null | undefined,
): boolean {
  return code == null || SUGGESTION_RULE_CODE_ALLOWLIST.has(code);
}
