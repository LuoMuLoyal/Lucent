import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from '../../types/suggestion.types.js';
import type { SuggestionCandidate } from '../../types/candidate.types.js';
import { ScoringService } from './scoring.service.js';

function buildCandidate(
  overrides: Partial<SuggestionCandidate> = {},
): SuggestionCandidate {
  return {
    candidateId: 'cand-1',
    ruleId: 'test_rule',
    ruleVersion: '1.0.0',
    type: SuggestionType.COMPLIANCE,
    triggerType: TriggerType.EVENT,
    evidence: [],
    primaryAction: {
      actionId: 'go',
      label: 'Go',
      route: '/test',
      authRequired: true,
    },
    priorityScore: 500,
    confidence: SuggestionConfidence.HIGH,
    notificationEligible: false,
    copyGeneration: {
      templateKey: 'test.template',
      params: {},
    },
    ...overrides,
  };
}

describe('ScoringService', () => {
  let service: ScoringService;

  beforeEach(() => {
    service = new ScoringService();
  });

  describe('score', () => {
    it('returns priorityScore * 1.0 for HIGH confidence', () => {
      const candidate = buildCandidate({
        priorityScore: 800,
        confidence: SuggestionConfidence.HIGH,
      });

      expect(service.score(candidate)).toBe(800);
    });

    it('returns priorityScore * 0.7 for MEDIUM confidence', () => {
      const candidate = buildCandidate({
        priorityScore: 800,
        confidence: SuggestionConfidence.MEDIUM,
      });

      expect(service.score(candidate)).toBeCloseTo(560, 5);
    });

    it('returns priorityScore * 0.3 for LOW confidence', () => {
      const candidate = buildCandidate({
        priorityScore: 800,
        confidence: SuggestionConfidence.LOW,
      });

      expect(service.score(candidate)).toBeCloseTo(240, 5);
    });

    it('returns 0 when priorityScore is 0', () => {
      const candidate = buildCandidate({
        priorityScore: 0,
        confidence: SuggestionConfidence.HIGH,
      });

      expect(service.score(candidate)).toBe(0);
    });

    it('returns 0 for 0 priorityScore with LOW confidence', () => {
      const candidate = buildCandidate({
        priorityScore: 0,
        confidence: SuggestionConfidence.LOW,
      });

      expect(service.score(candidate)).toBe(0);
    });

    it('handles negative priorityScore', () => {
      const candidate = buildCandidate({
        priorityScore: -100,
        confidence: SuggestionConfidence.HIGH,
      });

      expect(service.score(candidate)).toBe(-100);
    });

    it('handles very large priorityScore', () => {
      const candidate = buildCandidate({
        priorityScore: 1_000_000,
        confidence: SuggestionConfidence.HIGH,
      });

      expect(service.score(candidate)).toBe(1_000_000);
    });

    it('handles very large priorityScore with LOW confidence', () => {
      const candidate = buildCandidate({
        priorityScore: 1_000_000,
        confidence: SuggestionConfidence.LOW,
      });

      expect(service.score(candidate)).toBe(300_000);
    });

    it('ensures HIGH always scores above MEDIUM at same priority', () => {
      const high = buildCandidate({
        candidateId: 'h',
        priorityScore: 500,
        confidence: SuggestionConfidence.HIGH,
      });
      const medium = buildCandidate({
        candidateId: 'm',
        priorityScore: 500,
        confidence: SuggestionConfidence.MEDIUM,
      });

      expect(service.score(high)).toBeGreaterThan(service.score(medium));
    });

    it('ensures MEDIUM always scores above LOW at same priority', () => {
      const medium = buildCandidate({
        candidateId: 'm',
        priorityScore: 500,
        confidence: SuggestionConfidence.MEDIUM,
      });
      const low = buildCandidate({
        candidateId: 'l',
        priorityScore: 500,
        confidence: SuggestionConfidence.LOW,
      });

      expect(service.score(medium)).toBeGreaterThan(service.score(low));
    });

    it('allows high-priority LOW to beat low-priority HIGH', () => {
      const highPriorityLow = buildCandidate({
        candidateId: 'hpl',
        priorityScore: 1000,
        confidence: SuggestionConfidence.LOW,
      });
      const lowPriorityHigh = buildCandidate({
        candidateId: 'lph',
        priorityScore: 200,
        confidence: SuggestionConfidence.HIGH,
      });

      expect(service.score(highPriorityLow)).toBeGreaterThan(
        service.score(lowPriorityHigh),
      );
    });
  });
});
