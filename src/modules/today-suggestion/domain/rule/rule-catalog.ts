/**
 * The catalogue of registered suggestion rules.
 *
 * ## Why a plain array instead of eight DI providers
 *
 * Rules are **pure functions over signals** — none of them has a constructor
 * dependency, and none should grow one. Registering them as Nest providers
 * bought nothing and cost something real: DI would silently satisfy a
 * constructor dependency the day someone adds one, quietly turning a pure rule
 * into a stateful service (and making it untestable without a container). Here
 * they are constructed once, as data.
 *
 * The two *registries* (`RegistryService`, `RuleVersionRegistry`) stay
 * injectable: they hold the lookup state that `SuggestionPipelineService` reads.
 *
 * ## Adding a rule
 *
 * Add the class to this array and register its `ruleId` in
 * `product-events`'s `SUGGESTION_RULE_CODE_ALLOWLIST` — the two are locked
 * together by a drift guard (`events.service.spec.ts`), because a rule whose
 * code is missing there fails `recordBatch` with `VALIDATION_FAILED`.
 */

import type { SuggestionRule } from './rule-definition.js';

import { CoverageRuleService } from '../policies/medication/coverage.js';
import { MissedDoseRuleService } from '../policies/medication/missed-dose.js';
import { DietImbalanceRuleService } from '../policies/lifestyle/diet-imbalance.js';
import { DeterioratingTrendRuleService } from '../policies/lifestyle/deteriorating-trend.js';
import { WaterShortfallRuleService } from '../policies/lifestyle/water-shortfall.js';
import { MoodSleepRuleService } from '../policies/sleep/mood-sleep.js';
import { SleepShortfallRuleService } from '../policies/sleep/sleep-shortfall.js';
import { EventCheckInTrendRuleService } from '../policies/health/event-check-in-trend.js';

/**
 * Every rule the engine evaluates, in registration order.
 *
 * A function rather than a module-level array so each call returns fresh
 * instances: rules are immutable in practice, but handing the same objects to
 * two registries would make a future stateful rule leak between them.
 */
export function buildSuggestionRules(): SuggestionRule[] {
  return [
    new MissedDoseRuleService(),
    new WaterShortfallRuleService(),
    new SleepShortfallRuleService(),
    new DeterioratingTrendRuleService(),
    new DietImbalanceRuleService(),
    new MoodSleepRuleService(),
    new CoverageRuleService(),
    new EventCheckInTrendRuleService(),
  ];
}
