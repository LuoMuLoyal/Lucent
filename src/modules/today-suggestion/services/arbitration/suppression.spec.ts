import { SuppressionService } from './suppression.service';
import type { FeedbackService } from '../feedback/feedback.service';
import type { FeedbackEntry } from '../feedback/feedback.service';
import type { FeedbackStatsService } from '../feedback/feedback-stats.service';
import type { RuleFeedbackStats } from '../feedback/feedback-stats.service';
import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
  SuggestionFeedback,
} from '../../types';
import type { SuggestionCandidate } from '../../types';

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

function buildFeedbackEntry(
  overrides: Partial<FeedbackEntry> = {},
): FeedbackEntry {
  return {
    suggestionId: 'sug-test',
    suggestionType: SuggestionType.COMPLIANCE,
    feedback: SuggestionFeedback.SUPPRESS,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ruleId: 'test_rule',
    priorityScore: 500,
    ...overrides,
  };
}

/**
 * Creates a SuppressionService with a mocked FeedbackService
 * that returns the given feedback entries, and a mocked
 * FeedbackStatsService that returns the given stats.
 */
function createService(
  feedbacks: FeedbackEntry[],
  stats: Map<string, RuleFeedbackStats> = new Map(),
): SuppressionService {
  const mockFeedbackService = {
    loadActiveFeedbacks: jest.fn().mockResolvedValue(feedbacks),
  } as unknown as FeedbackService;

  const mockStatsService = {
    loadStats: jest.fn().mockResolvedValue(stats),
  } as unknown as FeedbackStatsService;

  return new SuppressionService(mockFeedbackService, mockStatsService);
}

describe('SuppressionService', () => {
  it('should return all candidates when no feedback exists', async () => {
    const service = createService([]);
    const c1 = buildCandidate({ candidateId: 'c1' });
    const c2 = buildCandidate({ candidateId: 'c2' });

    const result = await service.filterAndAdjust('user-1', [c1, c2]);

    expect(result.candidates).toHaveLength(2);
    expect(result.suppressedIds).toHaveLength(0);
  });

  it('should return empty when no candidates', async () => {
    const service = createService([
      buildFeedbackEntry({ feedback: SuggestionFeedback.SUPPRESS }),
    ]);

    const result = await service.filterAndAdjust('user-1', []);

    expect(result.candidates).toHaveLength(0);
    expect(result.suppressedIds).toHaveLength(0);
  });

  describe('suppress feedback', () => {
    it('should hard-suppress same-type candidates with lower or equal score', async () => {
      const service = createService([
        buildFeedbackEntry({
          feedback: SuggestionFeedback.SUPPRESS,
          suggestionType: SuggestionType.COMPLIANCE,
          priorityScore: 800,
        }),
      ]);

      const low = buildCandidate({
        candidateId: 'low',
        type: SuggestionType.COMPLIANCE,
        priorityScore: 700,
      });
      const equal = buildCandidate({
        candidateId: 'equal',
        type: SuggestionType.COMPLIANCE,
        priorityScore: 800,
      });

      const result = await service.filterAndAdjust('user-1', [low, equal]);

      expect(result.candidates).toHaveLength(0);
      expect(result.suppressedIds).toContain('low');
      expect(result.suppressedIds).toContain('equal');
    });

    it('should allow same-type candidates with higher score (severity escalation)', async () => {
      const service = createService([
        buildFeedbackEntry({
          feedback: SuggestionFeedback.SUPPRESS,
          suggestionType: SuggestionType.COMPLIANCE,
          priorityScore: 800,
        }),
      ]);

      const higher = buildCandidate({
        candidateId: 'higher',
        type: SuggestionType.COMPLIANCE,
        priorityScore: 900,
      });

      const result = await service.filterAndAdjust('user-1', [higher]);

      expect(result.candidates).toHaveLength(1);
      expect(result.suppressedIds).toHaveLength(0);
    });

    it('should not suppress candidates of a different type', async () => {
      const service = createService([
        buildFeedbackEntry({
          feedback: SuggestionFeedback.SUPPRESS,
          suggestionType: SuggestionType.COMPLIANCE,
          priorityScore: 800,
        }),
      ]);

      const water = buildCandidate({
        candidateId: 'water',
        type: SuggestionType.BEHAVIOR_ADVICE,
        priorityScore: 400,
      });

      const result = await service.filterAndAdjust('user-1', [water]);

      expect(result.candidates).toHaveLength(1);
      expect(result.suppressedIds).toHaveLength(0);
    });
  });

  describe('later feedback', () => {
    it('should delay same-rule candidates with lower or equal score', async () => {
      const service = createService([
        buildFeedbackEntry({
          feedback: SuggestionFeedback.LATER,
          ruleId: 'missed_dose_pending',
          priorityScore: 800,
        }),
      ]);

      const sameRule = buildCandidate({
        candidateId: 'same-rule',
        ruleId: 'missed_dose_pending',
        priorityScore: 800,
      });

      const result = await service.filterAndAdjust('user-1', [sameRule]);

      expect(result.candidates).toHaveLength(0);
      expect(result.suppressedIds).toContain('same-rule');
    });

    it('should allow same-rule candidates with higher score', async () => {
      const service = createService([
        buildFeedbackEntry({
          feedback: SuggestionFeedback.LATER,
          ruleId: 'missed_dose_pending',
          priorityScore: 800,
        }),
      ]);

      const higher = buildCandidate({
        candidateId: 'higher',
        ruleId: 'missed_dose_pending',
        priorityScore: 850,
      });

      const result = await service.filterAndAdjust('user-1', [higher]);

      expect(result.candidates).toHaveLength(1);
    });

    it('should not delay candidates from a different rule', async () => {
      const service = createService([
        buildFeedbackEntry({
          feedback: SuggestionFeedback.LATER,
          ruleId: 'missed_dose_pending',
          priorityScore: 800,
        }),
      ]);

      const otherRule = buildCandidate({
        candidateId: 'other',
        ruleId: 'water_behind_target',
        priorityScore: 400,
      });

      const result = await service.filterAndAdjust('user-1', [otherRule]);

      expect(result.candidates).toHaveLength(1);
    });
  });

  describe('not_applicable feedback', () => {
    it('should reduce score by 30% for same-type candidates', async () => {
      const service = createService([
        buildFeedbackEntry({
          feedback: SuggestionFeedback.NOT_APPLICABLE,
          suggestionType: SuggestionType.BEHAVIOR_ADVICE,
          priorityScore: 500,
        }),
      ]);

      const candidate = buildCandidate({
        candidateId: 'water',
        type: SuggestionType.BEHAVIOR_ADVICE,
        priorityScore: 400,
      });

      const result = await service.filterAndAdjust('user-1', [candidate]);

      expect(result.candidates).toHaveLength(1);
      // 400 - 30% = 400 - 120 = 280
      expect(result.candidates[0]!.priorityScore).toBe(280);
    });

    it('should not reduce score for higher-severity candidates', async () => {
      const service = createService([
        buildFeedbackEntry({
          feedback: SuggestionFeedback.NOT_APPLICABLE,
          suggestionType: SuggestionType.BEHAVIOR_ADVICE,
          priorityScore: 400,
        }),
      ]);

      const candidate = buildCandidate({
        candidateId: 'higher',
        type: SuggestionType.BEHAVIOR_ADVICE,
        priorityScore: 500,
      });

      const result = await service.filterAndAdjust('user-1', [candidate]);

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.priorityScore).toBe(500);
    });
  });

  describe('accepted feedback', () => {
    it('should boost score by 10% for same-type candidates', async () => {
      const service = createService([
        buildFeedbackEntry({
          feedback: SuggestionFeedback.ACCEPTED,
          suggestionType: SuggestionType.BEHAVIOR_ADVICE,
          priorityScore: 400,
          expiresAt: null, // permanent
        }),
      ]);

      const candidate = buildCandidate({
        candidateId: 'water',
        type: SuggestionType.BEHAVIOR_ADVICE,
        priorityScore: 400,
      });

      const result = await service.filterAndAdjust('user-1', [candidate]);

      expect(result.candidates).toHaveLength(1);
      // 400 + 10% = 400 + 40 = 440
      expect(result.candidates[0]!.priorityScore).toBe(440);
    });
  });

  describe('combined feedback scenarios', () => {
    it('should apply both accepted boost and not_applicable reduction', async () => {
      const service = createService([
        buildFeedbackEntry({
          feedback: SuggestionFeedback.ACCEPTED,
          suggestionType: SuggestionType.BEHAVIOR_ADVICE,
          priorityScore: 400,
          expiresAt: null,
        }),
        buildFeedbackEntry({
          feedback: SuggestionFeedback.NOT_APPLICABLE,
          suggestionType: SuggestionType.BEHAVIOR_ADVICE,
          priorityScore: 500,
        }),
      ]);

      const candidate = buildCandidate({
        candidateId: 'water',
        type: SuggestionType.BEHAVIOR_ADVICE,
        priorityScore: 400,
      });

      const result = await service.filterAndAdjust('user-1', [candidate]);

      expect(result.candidates).toHaveLength(1);
      // 400 - 30% + 10% = 400 - 120 + 40 = 320
      expect(result.candidates[0]!.priorityScore).toBe(320);
    });

    it('should suppress with higher priority over boost', async () => {
      const service = createService([
        buildFeedbackEntry({
          feedback: SuggestionFeedback.ACCEPTED,
          suggestionType: SuggestionType.COMPLIANCE,
          priorityScore: 500,
          expiresAt: null,
        }),
        buildFeedbackEntry({
          feedback: SuggestionFeedback.SUPPRESS,
          suggestionType: SuggestionType.COMPLIANCE,
          priorityScore: 800,
        }),
      ]);

      const candidate = buildCandidate({
        candidateId: 'c',
        type: SuggestionType.COMPLIANCE,
        priorityScore: 700,
      });

      const result = await service.filterAndAdjust('user-1', [candidate]);

      expect(result.candidates).toHaveLength(0);
      expect(result.suppressedIds).toContain('c');
    });
  });
});
