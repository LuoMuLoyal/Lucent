import { FeedbackStatsService } from './feedback-stats.service';

describe('FeedbackStatsService', () => {
  let service: FeedbackStatsService;
  let feedbackFindManyMock: jest.Mock;
  let suggestionFindManyMock: jest.Mock;

  beforeEach(() => {
    feedbackFindManyMock = jest.fn();
    suggestionFindManyMock = jest.fn();
    const prismaMock = {
      userSuggestionFeedback: {
        findMany: feedbackFindManyMock,
      },
      userSuggestion: {
        findMany: suggestionFindManyMock,
      },
    };
    service = new FeedbackStatsService(prismaMock as never);
  });

  /**
   * Helper: mocks feedback + suggestion findMany to return
   * the given feedback→ruleId pairs.
   */
  function mockFeedbackRulePairs(
    pairs: Array<{ feedback: string; suggestionId: string; ruleId: string }>,
  ): void {
    const feedbacks = pairs.map((p) => ({
      feedback: p.feedback,
      suggestionId: p.suggestionId,
    }));
    const suggestions = [...new Set(pairs.map((p) => p.suggestionId))].map(
      (id) => {
        const pair = pairs.find((p) => p.suggestionId === id)!;
        return { id, ruleId: pair.ruleId };
      },
    );
    feedbackFindManyMock.mockResolvedValue(feedbacks);
    suggestionFindManyMock.mockResolvedValue(suggestions);
  }

  it('should return empty map when no rule IDs provided', async () => {
    const result = await service.loadStats('user-1', []);
    expect(result.size).toBe(0);
  });

  it('should return neutral multiplier when sample size is below minimum', async () => {
    mockFeedbackRulePairs([
      { feedback: 'accepted', suggestionId: 'sug-1', ruleId: 'rule-a' },
    ]);

    const result = await service.loadStats('user-1', ['rule-a']);
    const stats = result.get('rule-a');
    expect(stats).toBeDefined();
    expect(stats!.scoreMultiplier).toBe(1.0);
    expect(stats!.totalFeedback).toBe(1);
  });

  it('should compute boost multiplier for high accept rate', async () => {
    const pairs: Array<{
      feedback: string;
      suggestionId: string;
      ruleId: string;
    }> = [];
    for (let i = 0; i < 8; i++) {
      pairs.push({
        feedback: 'accepted',
        suggestionId: `sug-${i}`,
        ruleId: 'rule-a',
      });
    }
    pairs.push({ feedback: 'later', suggestionId: 'sug-8', ruleId: 'rule-a' });
    pairs.push({
      feedback: 'suppress',
      suggestionId: 'sug-9',
      ruleId: 'rule-a',
    });
    mockFeedbackRulePairs(pairs);

    const result = await service.loadStats('user-1', ['rule-a']);
    const stats = result.get('rule-a')!;
    expect(stats.acceptRatio).toBe(0.8);
    expect(stats.suppressRatio).toBe(0.1);
    expect(stats.scoreMultiplier).toBeGreaterThan(1.0);
  });

  it('should compute reduction multiplier for high suppress rate', async () => {
    const pairs: Array<{
      feedback: string;
      suggestionId: string;
      ruleId: string;
    }> = [];
    pairs.push({
      feedback: 'accepted',
      suggestionId: 'sug-0',
      ruleId: 'rule-b',
    });
    pairs.push({ feedback: 'later', suggestionId: 'sug-1', ruleId: 'rule-b' });
    for (let i = 2; i < 10; i++) {
      pairs.push({
        feedback: 'suppress',
        suggestionId: `sug-${i}`,
        ruleId: 'rule-b',
      });
    }
    mockFeedbackRulePairs(pairs);

    const result = await service.loadStats('user-1', ['rule-b']);
    const stats = result.get('rule-b')!;
    expect(stats.suppressRatio).toBe(0.8);
    expect(stats.scoreMultiplier).toBeLessThan(1.0);
  });

  it('should return boost multiplier for balanced feedback with no suppress', async () => {
    const pairs: Array<{
      feedback: string;
      suggestionId: string;
      ruleId: string;
    }> = [];
    for (let i = 0; i < 3; i++) {
      pairs.push({
        feedback: 'accepted',
        suggestionId: `sug-${i}`,
        ruleId: 'rule-c',
      });
    }
    for (let i = 3; i < 5; i++) {
      pairs.push({
        feedback: 'later',
        suggestionId: `sug-${i}`,
        ruleId: 'rule-c',
      });
    }
    mockFeedbackRulePairs(pairs);

    const result = await service.loadStats('user-1', ['rule-c']);
    const stats = result.get('rule-c')!;
    expect(stats.acceptRatio).toBe(0.6);
    expect(stats.suppressRatio).toBe(0);
    expect(stats.scoreMultiplier).toBeGreaterThan(1.0);
  });

  it('should filter out feedback for unrequested ruleIds', async () => {
    mockFeedbackRulePairs([
      { feedback: 'accepted', suggestionId: 'sug-1', ruleId: 'rule-a' },
      { feedback: 'accepted', suggestionId: 'sug-2', ruleId: 'rule-b' },
      { feedback: 'accepted', suggestionId: 'sug-3', ruleId: 'rule-b' },
      { feedback: 'accepted', suggestionId: 'sug-4', ruleId: 'rule-b' },
      { feedback: 'accepted', suggestionId: 'sug-5', ruleId: 'rule-b' },
      { feedback: 'accepted', suggestionId: 'sug-6', ruleId: 'rule-b' },
    ]);

    const result = await service.loadStats('user-1', ['rule-b']);
    expect(result.has('rule-a')).toBe(false);
    expect(result.has('rule-b')).toBe(true);
  });

  it('should handle empty feedback results', async () => {
    feedbackFindManyMock.mockResolvedValue([]);

    const result = await service.loadStats('user-1', ['rule-a']);
    expect(result.size).toBe(0);
  });

  it('should handle suggestion not found for feedback', async () => {
    feedbackFindManyMock.mockResolvedValue([
      { feedback: 'accepted', suggestionId: 'sug-missing' },
    ]);
    suggestionFindManyMock.mockResolvedValue([]); // no suggestions found

    const result = await service.loadStats('user-1', ['rule-a']);
    expect(result.size).toBe(0);
  });
});
