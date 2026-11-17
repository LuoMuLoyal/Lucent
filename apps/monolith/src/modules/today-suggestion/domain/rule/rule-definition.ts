/**
 * The rule contract of the Daily Guidance context (ADR-0024 `domain/rule/`).
 *
 * A rule is a **pure predicate**: given the signals collected for one user-day
 * and a small context, it either produces a candidate or declines. It holds no
 * state between calls and has no collaborators — that is what makes the rule
 * set testable without a container, and it is enforced by construction
 * (`services/rules/rule-catalog.ts` builds them; nothing injects them).
 */

import type {
  SuggestionType,
  TriggerType,
} from '../suggestion/suggestion.types.js';
import type { SuggestionSignal } from '../signal/signal.js';
import type { SuggestionCandidate } from '../suggestion/suggestion-candidate.js';
import type { BaselineDimension } from '../baseline/baseline.js';

/** Context passed to each rule during matching. */
export interface RuleContext {
  userId: string;
  date: string;
  /** Current time-of-day bucket, useful for time-gated rules. */
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  /** Whether the user has established baselines for each dimension. */
  baselineStatus: Map<BaselineDimension, boolean>;
}

/**
 * Interface that every suggestion rule must implement.
 * Rules are registered in the RuleRegistry and invoked for each signal bundle.
 */
export interface SuggestionRule {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly type: SuggestionType;
  readonly triggerType: TriggerType;

  /** Whether this rule requires a baseline to be established before firing. */
  readonly isBaselineRequired: boolean;
  /** Dimensions that must be ready if `isBaselineRequired` is true. */
  readonly baselineDimensions?: BaselineDimension[];

  /** Signal kinds this rule can consume (for composition). */
  readonly consumableSignalKinds?: string[];

  /**
   * Evaluate the rule against the provided signals.
   * Returns a candidate if the rule matches, or null otherwise.
   */
  match(
    signals: SuggestionSignal[],
    context: RuleContext,
  ): SuggestionCandidate | null;
}
