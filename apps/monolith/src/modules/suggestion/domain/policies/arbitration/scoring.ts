import type { SuggestionCandidate } from '../../suggestion/suggestion-candidate.js';
import { SuggestionConfidence } from '../../suggestion/suggestion.types.js';

/** Confidence → numeric weight for scoring. */
const CONFIDENCE_WEIGHT: Record<SuggestionConfidence, number> = {
  [SuggestionConfidence.HIGH]: 1.0,
  [SuggestionConfidence.MEDIUM]: 0.7,
  [SuggestionConfidence.LOW]: 0.3,
};

/**
 * Pure scoring: converts a candidate's priorityScore + confidence into a final
 * sortable score.
 *
 * Lower confidence penalises the score so that high-confidence cards always
 * rank above low-confidence ones at the same base priority.
 */
export function scoreCandidate(candidate: SuggestionCandidate): number {
  return candidate.priorityScore * CONFIDENCE_WEIGHT[candidate.confidence];
}
