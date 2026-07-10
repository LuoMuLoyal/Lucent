import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api';
import type { UserPayload } from '../auth/types/auth-request';
import { TodaySuggestionController } from './today-suggestion.controller';
import { SuggestionService } from './services/suggestion.service';
import { FeedbackService } from './services/feedback/feedback.service';
import { ExplanationService } from './services/explanation/explanation.service';
import { LifecycleService } from './services/lifecycle/lifecycle.service';

const mockUser: UserPayload = {
  sub: 'user-uuid-1',
  email: 'test@example.com',
};

const mockSuggestionsData = {
  primary: {
    id: 'sug-1',
    type: 'confirmed_risk',
    title: 'Missing dose',
    reason: 'You missed your morning dose',
    boundary: 'Do not double the next dose',
    confidence: 'high',
    primaryAction: {
      actionId: 'log',
      label: 'Log dose',
      route: '/record/dose',
      authRequired: true,
    },
    lifecycleState: 'active',
    createdAt: '2026-07-10T08:00:00.000Z',
  },
  secondary: [],
  observations: [],
  generatedAt: '2026-07-10T08:00:00.000Z',
};

const mockFeedbackResult = {
  suggestionId: 'sug-1',
  feedback: 'accepted' as const,
  appliedEffect: 'boosted_type' as const,
  expiresAt: null,
};

const mockExplanationResult = {
  suggestionId: 'sug-1',
  reason: 'AI生成的解释',
  boundary: 'AI生成的边界',
  aiGenerated: true,
};

const mockHistoryResult = {
  items: [
    {
      id: 'sug-old-1',
      type: 'compliance',
      title: 'Past suggestion',
      lifecycleState: 'expired',
      createdAt: '2026-06-15T08:00:00.000Z',
    },
  ],
  total: 1,
};

describe('TodaySuggestionController', () => {
  let controller: TodaySuggestionController;
  let suggestionService: jest.Mocked<SuggestionService>;
  let feedbackService: jest.Mocked<FeedbackService>;
  let explanationService: jest.Mocked<ExplanationService>;
  let lifecycleService: jest.Mocked<LifecycleService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TodaySuggestionController],
      providers: [
        {
          provide: SuggestionService,
          useValue: {
            generate: jest.fn(),
          },
        },
        {
          provide: FeedbackService,
          useValue: {
            recordFeedback: jest.fn(),
          },
        },
        {
          provide: ExplanationService,
          useValue: {
            explain: jest.fn(),
          },
        },
        {
          provide: LifecycleService,
          useValue: {
            getHistory: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(TodaySuggestionController);
    suggestionService = module.get(SuggestionService);
    feedbackService = module.get(FeedbackService);
    explanationService = module.get(ExplanationService);
    lifecycleService = module.get(LifecycleService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /today/suggestions', () => {
    it('returns suggestions envelope with no excludeIds', async () => {
      suggestionService.generate.mockResolvedValue(
        mockSuggestionsData as never,
      );

      const result = await controller.getSuggestions(mockUser);

      expect(suggestionService.generate).toHaveBeenCalledWith(
        mockUser.sub,
        undefined,
        [],
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: mockSuggestionsData,
      });
    });

    it('passes date and single excludeIds as array', async () => {
      suggestionService.generate.mockResolvedValue(
        mockSuggestionsData as never,
      );

      await controller.getSuggestions(mockUser, '2026-07-10', 'sug-dismissed');

      expect(suggestionService.generate).toHaveBeenCalledWith(
        mockUser.sub,
        '2026-07-10',
        ['sug-dismissed'],
      );
    });

    it('passes array excludeIds as-is', async () => {
      suggestionService.generate.mockResolvedValue(
        mockSuggestionsData as never,
      );

      await controller.getSuggestions(mockUser, undefined, ['sug-1', 'sug-2']);

      expect(suggestionService.generate).toHaveBeenCalledWith(
        mockUser.sub,
        undefined,
        ['sug-1', 'sug-2'],
      );
    });
  });

  describe('POST /today/suggestions/:id/feedback', () => {
    it('records feedback and returns envelope', async () => {
      feedbackService.recordFeedback.mockResolvedValue(mockFeedbackResult);

      const result = await controller.submitFeedback(mockUser, 'sug-1', {
        feedback: 'accepted',
      });

      expect(feedbackService.recordFeedback).toHaveBeenCalledWith(
        mockUser.sub,
        'sug-1',
        'accepted',
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: {
          suggestionId: 'sug-1',
          feedback: 'accepted',
          appliedEffect: 'boosted_type',
        },
      });
    });

    it('includes expiresAt in response when present', async () => {
      feedbackService.recordFeedback.mockResolvedValue({
        ...mockFeedbackResult,
        expiresAt: '2026-07-11T08:00:00.000Z',
      });

      const result = await controller.submitFeedback(mockUser, 'sug-1', {
        feedback: 'later',
      });

      expect(result.data).toHaveProperty(
        'expiresAt',
        '2026-07-11T08:00:00.000Z',
      );
    });

    it('omits expiresAt from response when null', async () => {
      feedbackService.recordFeedback.mockResolvedValue({
        ...mockFeedbackResult,
        expiresAt: null,
      });

      const result = await controller.submitFeedback(mockUser, 'sug-1', {
        feedback: 'accepted',
      });

      expect(result.data).not.toHaveProperty('expiresAt');
    });
  });

  describe('POST /today/suggestions/:id/explain', () => {
    it('returns explanation envelope with language header', async () => {
      explanationService.explain.mockResolvedValue(mockExplanationResult);

      const result = await controller.explainSuggestion(
        mockUser,
        'sug-1',
        'zh-CN',
      );

      expect(explanationService.explain).toHaveBeenCalledWith(
        mockUser.sub,
        'sug-1',
        'zh-CN',
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: {
          suggestionId: 'sug-1',
          reason: 'AI生成的解释',
          boundary: 'AI生成的边界',
          aiGenerated: true,
        },
      });
    });

    it('works without accept-language header', async () => {
      explanationService.explain.mockResolvedValue(mockExplanationResult);

      await controller.explainSuggestion(mockUser, 'sug-1', undefined);

      expect(explanationService.explain).toHaveBeenCalledWith(
        mockUser.sub,
        'sug-1',
        undefined,
      );
    });
  });

  describe('GET /today/suggestions/history', () => {
    it('returns history envelope with defaults when no query provided', async () => {
      lifecycleService.getHistory.mockResolvedValue(mockHistoryResult as never);

      // Mock the static method
      const defaultDateSpy = jest
        .spyOn(LifecycleService, 'getDefaultStartDate')
        .mockReturnValue('2026-06-10');

      const result = await controller.getHistory(mockUser);

      const expectedEndDate = new Date().toISOString().slice(0, 10);
      expect(lifecycleService.getHistory).toHaveBeenCalledWith(
        mockUser.sub,
        '2026-06-10',
        expectedEndDate,
        {},
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: {
          items: mockHistoryResult.items,
          total: 1,
          startDate: '2026-06-10',
          endDate: expectedEndDate,
        },
      });

      defaultDateSpy.mockRestore();
    });

    it('passes explicit date range to service', async () => {
      lifecycleService.getHistory.mockResolvedValue(mockHistoryResult as never);

      const result = await controller.getHistory(
        mockUser,
        '2026-06-01',
        '2026-07-01',
      );

      expect(lifecycleService.getHistory).toHaveBeenCalledWith(
        mockUser.sub,
        '2026-06-01',
        '2026-07-01',
        {},
      );
      expect(result.data).toMatchObject({
        startDate: '2026-06-01',
        endDate: '2026-07-01',
      });
    });

    it('passes filter params to service', async () => {
      lifecycleService.getHistory.mockResolvedValue(mockHistoryResult as never);

      await controller.getHistory(
        mockUser,
        '2026-06-01',
        '2026-07-01',
        'active',
        'compliance',
        '50',
      );

      expect(lifecycleService.getHistory).toHaveBeenCalledWith(
        mockUser.sub,
        '2026-06-01',
        '2026-07-01',
        { lifecycleState: 'active', type: 'compliance', limit: 50 },
      );
    });

    it('omits undefined filter params from service call', async () => {
      lifecycleService.getHistory.mockResolvedValue(mockHistoryResult as never);

      await controller.getHistory(
        mockUser,
        '2026-06-01',
        '2026-07-01',
        undefined,
        'trend',
        undefined,
      );

      expect(lifecycleService.getHistory).toHaveBeenCalledWith(
        mockUser.sub,
        '2026-06-01',
        '2026-07-01',
        { type: 'trend' },
      );
    });
  });
});
