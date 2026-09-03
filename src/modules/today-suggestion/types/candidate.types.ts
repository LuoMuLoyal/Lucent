import type {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from './suggestion.types.js';
import type { EvidenceItem, SuggestionAction } from './signal.types.js';

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
  /** Sub-type for rendering variety (e.g. 'water', 'sleep', 'caffeine'). */
  subtype?: string;
  /** Metadata for AI copy generation. Rules should provide this. */
  copyGeneration: CopyGenerationMetadata;
}
