import { ArbitrationService } from './arbitration.service';
import { ScoringService } from './scoring.service';
import { SuggestionType, TriggerType, SuggestionConfidence } from '../../types';
import type { SuggestionCandidate } from '../../types';
import { MAX_SECONDARY_CARDS } from '../../constants';

function buildCandidate(
  overrides: Partial<SuggestionCandidate> = {},
): SuggestionCandidate {
  return {
    candidateId: `cand-${Math.random()}`,
    ruleId: 'test_rule',
    ruleVersion: '1.0.0',
    type: SuggestionType.COMPLIANCE,
    triggerType: TriggerType.EVENT,
    title: 'Test',
    reason: 'Test reason',
    evidence: [],
    boundary: 'Test boundary',
    primaryAction: {
      actionId: 'go',
      label: 'Go',
      route: '/test',
      authRequired: true,
    },
    priorityScore: 500,
    confidence: SuggestionConfidence.HIGH,
    notificationEligible: false,
    ...overrides,
  };
}

describe('ArbitrationService', () => {
  let service: ArbitrationService;

  beforeEach(() => {
    service = new ArbitrationService(new ScoringService());
  });

  it('should return empty result when no candidates', () => {
    const result = service.arbitrate([]);
    expect(result.primary).toBeNull();
    expect(result.secondary).toHaveLength(0);
    expect(result.observations).toHaveLength(0);
  });

  it('should pick highest-scored candidate as primary', () => {
    const low = buildCandidate({ candidateId: 'low', priorityScore: 300 });
    const high = buildCandidate({ candidateId: 'high', priorityScore: 800 });

    const result = service.arbitrate([low, high]);
    expect(result.primary?.candidateId).toBe('high');
  });

  it('should demote low-confidence candidates to observations', () => {
    const low = buildCandidate({
      candidateId: 'low',
      priorityScore: 1000,
      confidence: SuggestionConfidence.LOW,
    });
    const high = buildCandidate({
      candidateId: 'high',
      priorityScore: 500,
      confidence: SuggestionConfidence.HIGH,
    });

    const result = service.arbitrate([low, high]);
    expect(result.primary?.candidateId).toBe('high');
    expect(result.observations).toContainEqual(low);
  });

  it('should deduplicate by (type, subtype)', () => {
    const c1 = buildCandidate({
      candidateId: 'c1',
      type: SuggestionType.BEHAVIOR_ADVICE,
      subtype: 'water',
      priorityScore: 500,
    });
    const c2 = buildCandidate({
      candidateId: 'c2',
      type: SuggestionType.BEHAVIOR_ADVICE,
      subtype: 'water',
      priorityScore: 400,
    });

    const result = service.arbitrate([c1, c2]);
    expect(result.primary?.candidateId).toBe('c1');
    expect(result.secondary).toHaveLength(0);
    // c2 is a duplicate of c1, so it's dropped entirely (not in observations)
    expect(result.observations).toHaveLength(0);
  });

  it('should cap secondary cards at MAX_SECONDARY_CARDS', () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      buildCandidate({
        candidateId: `c${i}`,
        type: SuggestionType.BEHAVIOR_ADVICE,
        subtype: `subtype-${i}`,
        priorityScore: 1000 - i * 10,
      }),
    );

    const result = service.arbitrate(candidates);
    expect(result.secondary.length).toBeLessThanOrEqual(MAX_SECONDARY_CARDS);
  });
});

describe('ScoringService', () => {
  let service: ScoringService;

  beforeEach(() => {
    service = new ScoringService();
  });

  it('should weight high confidence at 1.0', () => {
    const candidate = buildCandidate({
      priorityScore: 800,
      confidence: SuggestionConfidence.HIGH,
    });
    expect(service.score(candidate)).toBe(800);
  });

  it('should weight medium confidence at 0.7', () => {
    const candidate = buildCandidate({
      priorityScore: 800,
      confidence: SuggestionConfidence.MEDIUM,
    });
    expect(service.score(candidate)).toBe(560);
  });

  it('should weight low confidence at 0.3', () => {
    const candidate = buildCandidate({
      priorityScore: 800,
      confidence: SuggestionConfidence.LOW,
    });
    expect(service.score(candidate)).toBe(240);
  });
});
