import { buildSuggestionRules } from './rule-catalog.js';

/**
 * Locks the rule catalogue itself.
 *
 * The array replaced eight DI providers, which means "a rule exists" is now a
 * plain data fact with no framework checking it. These assertions are what
 * stands in for that: a rule accidentally dropped from the array would
 * otherwise disappear from the engine silently — no error, just a suggestion
 * type that never fires again.
 *
 * The `ruleId` set is also mirrored in `product-events`'s
 * `SUGGESTION_RULE_CODE_ALLOWLIST` (drift guard:
 * `product-events/services/events.service.spec.ts`), so a change here that
 * skips that file fails over there.
 */
describe('buildSuggestionRules', () => {
  it('registers every rule the engine ships', () => {
    const rules = buildSuggestionRules();
    expect(rules.map((rule) => rule.ruleId).sort()).toEqual([
      'coverage_explanation',
      'deteriorating_symptom',
      'diet_imbalance',
      'event_check_in_trend',
      'missed_dose_pending',
      'mood_sleep_correlation',
      'sleep_shortfall',
      'water_behind_target',
    ]);
  });

  it('has no duplicate rule ids', () => {
    // `RegistryService.register` throws on a duplicate at startup, so a copy
    // pasted into the array would crash the app rather than fail a test. Pin it
    // here, where the message names the catalogue.
    const ids = buildSuggestionRules().map((rule) => rule.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns a fresh set of instances per call', () => {
    // Two registries must not share mutable rule objects.
    const first = buildSuggestionRules();
    const second = buildSuggestionRules();
    expect(first[0]).not.toBe(second[0]);
  });

  it('gives every rule the metadata the pipeline needs', () => {
    for (const rule of buildSuggestionRules()) {
      expect(rule.ruleVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(typeof rule.match).toBe('function');
      // A baseline-gated rule without dimensions can never be evaluated.
      if (rule.isBaselineRequired) {
        expect(rule.baselineDimensions?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});
