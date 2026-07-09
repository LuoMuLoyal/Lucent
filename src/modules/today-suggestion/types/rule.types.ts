import type { SuggestionType, TriggerType } from './suggestion.types';
import type { SuggestionSignal } from './signal.types';
import type { SuggestionCandidate } from './candidate.types';
import type { BaselineDimension } from './baseline.types';

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
