import { Injectable } from '@nestjs/common';
import type { SuggestionCandidate } from '../../types/candidate.types';
import { SuggestionConfidence } from '../../types/suggestion.types';
import { MAX_SECONDARY_CARDS } from '../../constants/thresholds.constants';
import { ScoringService } from './scoring.service';

interface ScoredCandidate {
  candidate: SuggestionCandidate;
  score: number;
}

/** Result of arbitration: primary, secondary, and observation candidates. */
export interface ArbitrationResult {
  primary: SuggestionCandidate | null;
  secondary: SuggestionCandidate[];
  observations: SuggestionCandidate[];
}

/**
 * Arbitration layer: filters, sorts, deduplicates, and truncates
 * candidates into the final 1 + 2 + N structure.
 */
@Injectable()
export class ArbitrationService {
  constructor(private readonly scoringService: ScoringService) {}

  arbitrate(candidates: SuggestionCandidate[]): ArbitrationResult {
    if (candidates.length === 0) {
      return { primary: null, secondary: [], observations: [] };
    }

    // Score all candidates
    const scored: ScoredCandidate[] = candidates.map((c) => ({
      candidate: c,
      score: this.scoringService.score(c),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Separate high/medium confidence from low confidence
    const strong: ScoredCandidate[] = [];
    const weak: ScoredCandidate[] = [];
    for (const item of scored) {
      if (item.candidate.confidence === SuggestionConfidence.LOW) {
        weak.push(item);
      } else {
        strong.push(item);
      }
    }

    // Deduplicate by (type, subtype)
    const seen = new Set<string>();
    const deduped = strong.filter((item) => {
      const key = `${item.candidate.type}:${item.candidate.subtype ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Pick primary (highest score)
    const primary = deduped[0]?.candidate ?? null;

    // Pick secondary (up to MAX_SECONDARY_CARDS, excluding primary)
    const secondary: SuggestionCandidate[] = [];
    for (
      let i = 1;
      i < deduped.length && secondary.length < MAX_SECONDARY_CARDS;
      i++
    ) {
      secondary.push(deduped[i]!.candidate); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }

    // Observations: remaining strong + all weak
    const usedIds = new Set<string>();
    if (primary != null) usedIds.add(primary.candidateId);
    for (const s of secondary) usedIds.add(s.candidateId);

    const observations: SuggestionCandidate[] = [
      ...deduped
        .filter((item) => !usedIds.has(item.candidate.candidateId))
        .map((item) => item.candidate),
      ...weak.map((item) => item.candidate),
    ];

    return { primary, secondary, observations };
  }
}
