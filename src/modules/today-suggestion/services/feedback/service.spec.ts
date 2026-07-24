import { NotFoundException } from '@nestjs/common';
import { FeedbackService } from './service';
import {
  SuggestionType,
  SuggestionFeedback,
} from '../../types/suggestion.types';
import {
  FEEDBACK_LATER_DURATION_MS,
  FEEDBACK_NOT_APPLICABLE_DURATION_MS,
  FEEDBACK_SUPPRESS_DURATION_MS,
  FEEDBACK_ACCEPTED_BOOST_PERCENT,
  FEEDBACK_NOT_APPLICABLE_REDUCTION_PERCENT,
} from '../../constants/feedback.constants';

describe('FeedbackService', () => {
  let service: FeedbackService;
  let findFirstMock: vi.Mock;
  let findManyMock: vi.Mock;
  let findUniqueMock: vi.Mock;
  let createSuggestionMock: vi.Mock;
  let updateManyMock: vi.Mock;
  let updateMock: vi.Mock;
  let feedbackCreateMock: vi.Mock;
  let feedbackFindManyMock: vi.Mock;
  let transactionMock: vi.Mock;

  beforeEach(() => {
    findFirstMock = vi.fn();
    findManyMock = vi.fn();
    findUniqueMock = vi.fn();
    createSuggestionMock = vi.fn();
    updateManyMock = vi.fn();
    updateMock = vi.fn();
    feedbackCreateMock = vi.fn();
    feedbackFindManyMock = vi.fn();

    const prismaMock = {
      userSuggestion: {
        findFirst: findFirstMock,
        findMany: findManyMock,
        findUnique: findUniqueMock,
        create: createSuggestionMock,
        updateMany: updateManyMock,
        update: updateMock,
      },
      userSuggestionFeedback: {
        create: feedbackCreateMock,
        findMany: feedbackFindManyMock,
      },
    };

    // $transaction mock: execute the callback with the same prisma mock as tx client
    transactionMock = vi.fn(
      async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
    );
    (prismaMock as never as { $transaction: vi.Mock }).$transaction =
      transactionMock;

    service = new FeedbackService(
      prismaMock as never,
      {
        invalidateSuggestions: vi.fn().mockResolvedValue(undefined),
      } as never,
    );
  });

  describe('recordFeedback', () => {
    it('should throw NotFoundException if suggestion does not exist', async () => {
      findFirstMock.mockResolvedValue(null);

      await expect(
        service.recordFeedback('user-1', 'sug-1', SuggestionFeedback.LATER),
      ).rejects.toThrow(NotFoundException);
    });

    it('should record accepted feedback with no expiry', async () => {
      findFirstMock.mockResolvedValue({
        id: 'sug-1',
        type: 'compliance',
        ruleId: 'missed_dose_pending',
        priorityScore: 800,
        lifecycleState: 'active',
      });
      feedbackCreateMock.mockResolvedValue({});
      updateManyMock.mockResolvedValue({
        count: 1,
      });

      const result = await service.recordFeedback(
        'user-1',
        'sug-1',
        SuggestionFeedback.ACCEPTED,
      );

      expect(result.appliedEffect).toBe('boosted_type');
      expect(result.expiresAt).toBeNull();

      // Should not mark as dismissed for accepted
      const updateCall = updateManyMock.mock.calls[0]![0];
      expect(updateCall.data.lifecycleState).toBeUndefined();
      expect(updateCall.data.feedback).toBe('accepted');
    });

    it('should record later feedback with 4-hour expiry and mark as dismissed', async () => {
      findFirstMock.mockResolvedValue({
        id: 'sug-1',
        type: 'compliance',
        ruleId: 'missed_dose_pending',
        priorityScore: 800,
        lifecycleState: 'active',
      });
      feedbackCreateMock.mockResolvedValue({});
      updateManyMock.mockResolvedValue({
        count: 1,
      });

      const before = Date.now();
      const result = await service.recordFeedback(
        'user-1',
        'sug-1',
        SuggestionFeedback.LATER,
      );
      const after = Date.now();

      expect(result.appliedEffect).toBe('delayed_until');
      expect(result.expiresAt).not.toBeNull();

      const expiresAt = new Date(result.expiresAt!).getTime();
      const expectedMin = before + FEEDBACK_LATER_DURATION_MS;
      const expectedMax = after + FEEDBACK_LATER_DURATION_MS;
      expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt).toBeLessThanOrEqual(expectedMax);

      // Should mark as dismissed for later
      const updateCall = updateManyMock.mock.calls[0]![0];
      expect(updateCall.data.lifecycleState).toBe('dismissed');
    });

    it('should record not_applicable feedback with 7-day expiry', async () => {
      findFirstMock.mockResolvedValue({
        id: 'sug-1',
        type: 'behavior_advice',
        ruleId: 'water_behind_target',
        priorityScore: 400,
        lifecycleState: 'active',
      });
      feedbackCreateMock.mockResolvedValue({});
      updateManyMock.mockResolvedValue({
        count: 1,
      });

      const before = Date.now();
      const result = await service.recordFeedback(
        'user-1',
        'sug-1',
        SuggestionFeedback.NOT_APPLICABLE,
      );

      expect(result.appliedEffect).toBe('suppressed_type');
      const expiresAt = new Date(result.expiresAt!).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(
        before + FEEDBACK_NOT_APPLICABLE_DURATION_MS,
      );

      // Should not mark as dismissed for not_applicable
      const updateCall = updateManyMock.mock.calls[0]![0];
      expect(updateCall.data.lifecycleState).toBeUndefined();
    });

    it('should record suppress feedback with 30-day expiry and mark as dismissed', async () => {
      findFirstMock.mockResolvedValue({
        id: 'sug-1',
        type: 'behavior_advice',
        ruleId: 'water_behind_target',
        priorityScore: 400,
        lifecycleState: 'active',
      });
      feedbackCreateMock.mockResolvedValue({});
      updateManyMock.mockResolvedValue({
        count: 1,
      });

      const before = Date.now();
      const result = await service.recordFeedback(
        'user-1',
        'sug-1',
        SuggestionFeedback.SUPPRESS,
      );

      expect(result.appliedEffect).toBe('suppressed_type');
      const expiresAt = new Date(result.expiresAt!).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(
        before + FEEDBACK_SUPPRESS_DURATION_MS,
      );

      // Should mark as dismissed for suppress
      const updateCall = updateManyMock.mock.calls[0]![0];
      expect(updateCall.data.lifecycleState).toBe('dismissed');
    });

    it('should return noted effect for unknown feedback type', async () => {
      findFirstMock.mockResolvedValue({
        id: 'sug-1',
        type: 'compliance',
        ruleId: 'missed_dose_pending',
        priorityScore: 800,
        lifecycleState: 'active',
      });
      feedbackCreateMock.mockResolvedValue({});
      updateManyMock.mockResolvedValue({ count: 1 });

      const result = await service.recordFeedback(
        'user-1',
        'sug-1',
        'unknown_feedback' as SuggestionFeedback,
      );

      expect(result.appliedEffect).toBe('noted');
      expect(result.expiresAt).toBeNull();

      // Should not mark as dismissed for unknown feedback
      const updateCall = updateManyMock.mock.calls[0]![0];
      expect(updateCall.data.lifecycleState).toBeUndefined();
    });

    it('should propagate error when transaction fails', async () => {
      findFirstMock.mockResolvedValue({
        id: 'sug-1',
        type: 'compliance',
        ruleId: 'missed_dose_pending',
        priorityScore: 800,
        lifecycleState: 'active',
      });
      transactionMock.mockRejectedValue(new Error('TX failed'));

      await expect(
        service.recordFeedback('user-1', 'sug-1', SuggestionFeedback.LATER),
      ).rejects.toThrow('TX failed');
    });

    it('should return correct suggestionId and feedback in result', async () => {
      findFirstMock.mockResolvedValue({
        id: 'sug-1',
        type: 'compliance',
        ruleId: 'missed_dose_pending',
        priorityScore: 800,
        lifecycleState: 'active',
      });
      feedbackCreateMock.mockResolvedValue({});
      updateManyMock.mockResolvedValue({ count: 1 });

      const result = await service.recordFeedback(
        'user-1',
        'sug-1',
        SuggestionFeedback.ACCEPTED,
      );

      expect(result.suggestionId).toBe('sug-1');
      expect(result.feedback).toBe(SuggestionFeedback.ACCEPTED);
    });
  });

  describe('static methods', () => {
    it('getAcceptedBoostPercent returns the boost percentage', () => {
      expect(FeedbackService.getAcceptedBoostPercent()).toBe(
        FEEDBACK_ACCEPTED_BOOST_PERCENT,
      );
    });

    it('getNotApplicableReductionPercent returns the reduction percentage', () => {
      expect(FeedbackService.getNotApplicableReductionPercent()).toBe(
        FEEDBACK_NOT_APPLICABLE_REDUCTION_PERCENT,
      );
    });
  });

  describe('loadActiveFeedbacks', () => {
    it('should return empty array when no feedbacks exist', async () => {
      feedbackFindManyMock.mockResolvedValue([]);

      const result = await service.loadActiveFeedbacks('user-1');

      expect(result).toEqual([]);
    });

    it('should augment feedback entries with suggestion data', async () => {
      feedbackFindManyMock.mockResolvedValue([
        {
          suggestionId: 'sug-1',
          suggestionType: 'compliance',
          feedback: 'suppress',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        {
          suggestionId: 'sug-2',
          suggestionType: 'behavior_advice',
          feedback: 'accepted',
          expiresAt: null,
        },
      ]);

      findManyMock.mockResolvedValue([
        { id: 'sug-1', ruleId: 'missed_dose_pending', priorityScore: 800 },
        { id: 'sug-2', ruleId: 'water_behind_target', priorityScore: 400 },
      ]);

      const result = await service.loadActiveFeedbacks('user-1');

      expect(result).toHaveLength(2);
      expect(result[0]!.ruleId).toBe('missed_dose_pending');
      expect(result[0]!.priorityScore).toBe(800);
      expect(result[0]!.suggestionType).toBe(SuggestionType.COMPLIANCE);
      expect(result[1]!.ruleId).toBe('water_behind_target');
      expect(result[1]!.priorityScore).toBe(400);
    });

    it('should filter out feedbacks whose suggestion was deleted', async () => {
      feedbackFindManyMock.mockResolvedValue([
        {
          suggestionId: 'sug-1',
          suggestionType: 'compliance',
          feedback: 'suppress',
          expiresAt: new Date(Date.now() + 1000),
        },
        {
          suggestionId: 'sug-deleted',
          suggestionType: 'behavior_advice',
          feedback: 'accepted',
          expiresAt: null,
        },
      ]);

      // Only sug-1 exists, sug-deleted was deleted
      findManyMock.mockResolvedValue([
        { id: 'sug-1', ruleId: 'missed_dose_pending', priorityScore: 800 },
      ]);

      const result = await service.loadActiveFeedbacks('user-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.suggestionId).toBe('sug-1');
    });
  });
});
