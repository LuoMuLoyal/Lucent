import { Injectable } from '@nestjs/common';
import type { SuggestionCandidate } from '../../types';
import { SuggestionConfidence } from '../../types';

/** Confidence → numeric weight for scoring. */
const CONFIDENCE_WEIGHT: Record<SuggestionConfidence, number> = {
  [SuggestionConfidence.HIGH]: 1.0,
  [SuggestionConfidence.MEDIUM]: 0.7,
  [SuggestionConfidence.LOW]: 0.3,
};

/**
 * Pure scoring service: converts a candidate's priorityScore + confidence
 * into a final sortable score.
 */
@Injectable()
export class ScoringService {
  /**
   * Computes the final score: priorityScore * confidenceWeight.
   * Lower confidence penalises the score so that high-confidence
   * cards always rank above low-confidence ones at the same base priority.
   */
  score(candidate: SuggestionCandidate): number {
    return candidate.priorityScore * CONFIDENCE_WEIGHT[candidate.confidence];
  }
}
