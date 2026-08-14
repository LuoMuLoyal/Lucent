/**
 * Server-side allowlist of suggestion rule codes accepted for the
 * `suggestionRuleCode` product-event attribute. Mirrors the `ruleId` values
 * registered in today-suggestion's `RegistryService` (each rule service
 * exposes `readonly ruleId`). No free-form strings are ever accepted.
 *
 * Sync guarantee: the drift-guard test in `events.service.spec.ts`
 * instantiates the registered rule service classes and asserts set equality
 * against this list. Adding a rule to the registry therefore requires
 * updating BOTH this allowlist AND the spec's registered-rule list; the
 * drift-guard test then locks the two sides together.
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
