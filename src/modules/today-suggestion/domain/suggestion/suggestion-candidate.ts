/**
 * Suggestion candidate vocabulary (ADR-0024 `domain/suggestion/`).
 *
 * A **candidate** is what a rule emits before arbitration: a proposed card plus
 * the evidence and copy metadata that justify it. It is not yet a persisted
 * suggestion — suppression and arbitration may drop it, which is why it has no
 * lifecycle state here.
 *
 * `candidateId` is generated per evaluation and never persisted; it exists so
 * arbitration and suppression can refer to one candidate in logs and in the
 * `suppressedIds` they return.
 */

import type {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from './suggestion.types.js';
import type { EvidenceItem, SuggestionAction } from '../signal/signal.js';

/**
 * Copy generation metadata for AI-powered suggestion copy.
 * Rules should provide this instead of hardcoded strings.
 */
export interface CopyGenerationMetadata {
  /** Template key for copy generation (e.g., 'coverage.profile.incomplete') */
  templateKey: string;
  /** Parameters to inject into the template */
  params: Record<string, string | number>;
}

/**
 * A fact a rule could not express inside the candidate, reported so the
 * **caller** can decide whether and how to log it.
 *
 * The domain layer returns facts, never log lines and never a logger: a rule
 * that took a `logger` would depend on a framework, and one that returned a
 * preformatted message would be deciding presentation for its caller. This is
 * the escape hatch that keeps the rule layer framework-free while leaving
 * "something upstream looks wrong" observable.
 */
export type RuleDiagnostic = {
  readonly kind: 'discardedRouteParam';
  /** The route query parameter that was omitted from the action route. */
  readonly param: string;
  /** `typeof` the rejected value, so the caller can tell what actually arrived. */
  readonly receivedType: string;
};

/**
 * A candidate suggestion produced by a rule.
 * The arbitration layer filters, scores, and truncates candidates
 * into the final response.
 */
export interface SuggestionCandidate {
  candidateId: string;
  ruleId: string;
  ruleVersion: string;
  type: SuggestionType;
  triggerType: TriggerType;
  evidence: EvidenceItem[];
  primaryAction: SuggestionAction;
  secondaryActions?: SuggestionAction[];
  priorityScore: number;
  confidence: SuggestionConfidence;
  expiresAt?: Date;
  notificationEligible: boolean;
  /** Signal IDs that composed this candidate, if any. */
  composedFrom?: string[];
  /** Sub-type for rendering variety (e.g. 'water', 'sleep', 'diet'). */
  subtype?: string;
  /** Metadata for AI copy generation. Rules should provide this. */
  copyGeneration: CopyGenerationMetadata;
  /**
   * Non-fatal problems the rule hit while building this candidate.
   *
   * Purely for the caller's observability — nothing here affects the card the
   * user sees. Omitted when the rule had nothing to report.
   */
  diagnostics?: readonly RuleDiagnostic[];
}
