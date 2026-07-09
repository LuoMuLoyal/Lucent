import type {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from './suggestion.types';
import type { EvidenceItem, SuggestionAction } from './signal.types';

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
  title: string;
  reason: string;
  evidence: EvidenceItem[];
  boundary: string;
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
}
