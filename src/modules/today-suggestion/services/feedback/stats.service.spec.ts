import { FeedbackStatsService } from './stats.service';

describe('FeedbackStatsService', () => {
  let service: FeedbackStatsService;
  let feedbackFindManyMock: vi.Mock;
  let suggestionFindManyMock: vi.Mock;

  beforeEach(() => {
    feedbackFindManyMock = vi.fn();
    suggestionFindManyMock = vi.fn();
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

  it('should apply boost when sample size is exactly at minimum (5)', async () => {
    const pairs: Array<{
      feedback: string;
      suggestionId: string;
      ruleId: string;
    }> = [];
    for (let i = 0; i < 4; i++) {
      pairs.push({
        feedback: 'accepted',
        suggestionId: `sug-${i}`,
        ruleId: 'rule-exact',
      });
    }
    pairs.push({
      feedback: 'later',
      suggestionId: 'sug-4',
      ruleId: 'rule-exact',
    });
    mockFeedbackRulePairs(pairs);

    const result = await service.loadStats('user-1', ['rule-exact']);
    const stats = result.get('rule-exact')!;
    expect(stats.totalFeedback).toBe(5);
    expect(stats.acceptRatio).toBe(0.8);
    expect(stats.scoreMultiplier).toBeGreaterThan(1.0);
  });

  it('should include not_applicable feedback in stats', async () => {
    const pairs: Array<{
      feedback: string;
      suggestionId: string;
      ruleId: string;
    }> = [];
    for (let i = 0; i < 3; i++) {
      pairs.push({
        feedback: 'not_applicable',
        suggestionId: `sug-${i}`,
        ruleId: 'rule-na',
      });
    }
    for (let i = 3; i < 5; i++) {
      pairs.push({
        feedback: 'accepted',
        suggestionId: `sug-${i}`,
        ruleId: 'rule-na',
      });
    }
    mockFeedbackRulePairs(pairs);

    const result = await service.loadStats('user-1', ['rule-na']);
    const stats = result.get('rule-na')!;
    expect(stats.notApplicableCount).toBe(3);
    expect(stats.acceptedCount).toBe(2);
    expect(stats.totalFeedback).toBe(5);
  });

  it('should cap multiplier at MAX_BOOST (1.5) for all-accepted', async () => {
    const pairs: Array<{
      feedback: string;
      suggestionId: string;
      ruleId: string;
    }> = [];
    for (let i = 0; i < 10; i++) {
      pairs.push({
        feedback: 'accepted',
        suggestionId: `sug-${i}`,
        ruleId: 'rule-max-boost',
      });
    }
    mockFeedbackRulePairs(pairs);

    const result = await service.loadStats('user-1', ['rule-max-boost']);
    const stats = result.get('rule-max-boost')!;
    expect(stats.scoreMultiplier).toBe(1.5);
  });

  it('should cap multiplier at MIN_REDUCTION (0.5) for all-suppressed', async () => {
    const pairs: Array<{
      feedback: string;
      suggestionId: string;
      ruleId: string;
    }> = [];
    for (let i = 0; i < 10; i++) {
      pairs.push({
        feedback: 'suppress',
        suggestionId: `sug-${i}`,
        ruleId: 'rule-max-reduce',
      });
    }
    mockFeedbackRulePairs(pairs);

    const result = await service.loadStats('user-1', ['rule-max-reduce']);
    const stats = result.get('rule-max-reduce')!;
    expect(stats.scoreMultiplier).toBe(0.5);
  });

  it('should round multiplier to 2 decimal places', async () => {
    // 3 accepted, 2 later, 0 suppress → acceptRatio = 0.6
    // multiplier = 1 + 0.6*0.5 - 0 = 1.30
    const pairs: Array<{
      feedback: string;
      suggestionId: string;
      ruleId: string;
    }> = [];
    for (let i = 0; i < 3; i++) {
      pairs.push({
        feedback: 'accepted',
        suggestionId: `sug-${i}`,
        ruleId: 'rule-round',
      });
    }
    for (let i = 3; i < 5; i++) {
      pairs.push({
        feedback: 'later',
        suggestionId: `sug-${i}`,
        ruleId: 'rule-round',
      });
    }
    mockFeedbackRulePairs(pairs);

    const result = await service.loadStats('user-1', ['rule-round']);
    const stats = result.get('rule-round')!;
    // 1 + 0.6*0.5 = 1.30, rounded to 2 decimals = 1.3
    expect(stats.scoreMultiplier).toBe(1.3);
  });

  it('should handle multiple rules in a single call', async () => {
    const pairs: Array<{
      feedback: string;
      suggestionId: string;
      ruleId: string;
    }> = [];
    // rule-multi-a: 8 accepted, 2 suppress
    for (let i = 0; i < 8; i++) {
      pairs.push({
        feedback: 'accepted',
        suggestionId: `sug-a-${i}`,
        ruleId: 'rule-multi-a',
      });
    }
    for (let i = 0; i < 2; i++) {
      pairs.push({
        feedback: 'suppress',
        suggestionId: `sug-a-s-${i}`,
        ruleId: 'rule-multi-a',
      });
    }
    // rule-multi-b: 5 suppress
    for (let i = 0; i < 5; i++) {
      pairs.push({
        feedback: 'suppress',
        suggestionId: `sug-b-${i}`,
        ruleId: 'rule-multi-b',
      });
    }
    mockFeedbackRulePairs(pairs);

    const result = await service.loadStats('user-1', [
      'rule-multi-a',
      'rule-multi-b',
    ]);
    expect(result.size).toBe(2);
    expect(result.get('rule-multi-a')!.scoreMultiplier).toBeGreaterThan(1.0);
    expect(result.get('rule-multi-b')!.scoreMultiplier).toBeLessThan(1.0);
  });
});
