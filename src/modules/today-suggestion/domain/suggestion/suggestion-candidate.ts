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
}
