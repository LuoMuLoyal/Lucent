import { FeedbackReadModel } from './feedback-read.js';
import type { FeedbackPort } from '../ports/feedback.js';
import {
  SuggestionType,
  SuggestionFeedback,
} from '../../domain/suggestion/suggestion.types.js';

const AT = new Date('2026-07-10T08:00:00.000Z');

function buildPort(overrides: Partial<FeedbackPort> = {}): FeedbackPort {
  return {
    findSuggestion: vi.fn().mockResolvedValue(null),
    recordDecision: vi.fn().mockResolvedValue(undefined),
    listActiveFeedback: vi.fn().mockResolvedValue([]),
    listFeedbackSince: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as FeedbackPort;
}

describe('FeedbackReadModel', () => {
  describe('loadActive', () => {
    it('returns an empty list when no feedback rows exist', async () => {
      const model = new FeedbackReadModel(buildPort());

      await expect(model.loadActive('user-1', AT)).resolves.toEqual([]);
    });

    it('maps rows to feedback entries', async () => {
      const port = buildPort({
        listActiveFeedback: vi.fn().mockResolvedValue([
          {
            suggestionId: 'sug-1',
            suggestionType: 'compliance',
            feedback: 'suppress',
            appliedAt: AT,
            expiresAt: new Date(AT.getTime() + 1000),
            ruleId: 'missed_dose_pending',
            priorityScore: 800,
          },
          {
            suggestionId: 'sug-2',
            suggestionType: 'behavior_advice',
            feedback: 'accepted',
            appliedAt: AT,
            expiresAt: null,
            ruleId: 'water_behind_target',
            priorityScore: 400,
          },
        ]),
      });
      const model = new FeedbackReadModel(port);

      const result = await model.loadActive('user-1', AT);

      expect(result).toHaveLength(2);
      expect(result[0]!.ruleId).toBe('missed_dose_pending');
      expect(result[0]!.priorityScore).toBe(800);
      expect(result[0]!.suggestionType).toBe(SuggestionType.COMPLIANCE);
      expect(result[1]!.ruleId).toBe('water_behind_target');
      expect(result[1]!.priorityScore).toBe(400);
      expect(port.listActiveFeedback).toHaveBeenCalledWith('user-1', AT);
    });

    it('passes the evaluation time through to the port', async () => {
      const listActiveFeedback = vi.fn().mockResolvedValue([]);
      const model = new FeedbackReadModel(buildPort({ listActiveFeedback }));

      await model.loadActive('user-1', AT);

      expect(listActiveFeedback).toHaveBeenCalledWith('user-1', AT);
    });
  });

  describe('loadStats', () => {
    it('skips the lookup when no rule IDs are requested', async () => {
      const listFeedbackSince = vi.fn().mockResolvedValue([]);
      const model = new FeedbackReadModel(buildPort({ listFeedbackSince }));

      const result = await model.loadStats('user-1', [], AT);

      expect(result.size).toBe(0);
      expect(listFeedbackSince).not.toHaveBeenCalled();
    });

    it('looks back the statistics window from the evaluation time', async () => {
      const listFeedbackSince = vi.fn().mockResolvedValue([]);
      const model = new FeedbackReadModel(buildPort({ listFeedbackSince }));

      await model.loadStats('user-1', ['rule-a'], AT);

      const since = (listFeedbackSince.mock.calls[0] as [string, Date])[1];
      const lookbackDays =
        (AT.getTime() - since.getTime()) / (24 * 60 * 60 * 1000);
      expect(lookbackDays).toBe(30);
    });

    it('aggregates rows into per-rule statistics', async () => {
      const model = new FeedbackReadModel(
        buildPort({
          listFeedbackSince: vi.fn().mockResolvedValue([
            {
              suggestionId: 'sug-1',
              feedback: SuggestionFeedback.ACCEPTED,
              appliedAt: AT,
              ruleId: 'rule-a',
            },
            {
              suggestionId: 'sug-2',
              feedback: SuggestionFeedback.SUPPRESS,
              appliedAt: AT,
              ruleId: 'rule-a',
            },
          ]),
        }),
      );

      const result = await model.loadStats('user-1', ['rule-a'], AT);

      const stats = result.get('rule-a');
      expect(stats).toBeDefined();
      expect(stats!.acceptedCount).toBe(1);
      expect(stats!.suppressCount).toBe(1);
      expect(stats!.totalFeedback).toBe(2);
    });

    it('drops rules that were not requested', async () => {
      const model = new FeedbackReadModel(
        buildPort({
          listFeedbackSince: vi.fn().mockResolvedValue([
            {
              suggestionId: 'sug-1',
              feedback: SuggestionFeedback.ACCEPTED,
              appliedAt: AT,
              ruleId: 'rule-b',
            },
          ]),
        }),
      );

      const result = await model.loadStats('user-1', ['rule-a'], AT);

      expect(result.size).toBe(0);
    });
  });
});
