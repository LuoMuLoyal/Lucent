import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode, formatDateOnly, now } from '../../common';
import type { UserPayload } from '../auth';
import { TodaySuggestionController } from './today-suggestion.controller';
import { SuggestionService } from './services/suggestion.service';
import { FeedbackService } from './services/feedback/recorder.service';
import { ExplanationService } from './services/explanation/explainer.service';
import { ExplanationQueueService } from './services/explanation/queue.service';
import { LifecycleService } from './services/lifecycle/manager.service';

const mockUser: UserPayload = {
  sub: 'user-uuid-1',
  email: 'test@example.com',
  status: 'active',
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
  feedback: 'accepted' as never,
  appliedEffect: 'boosted_type' as const,
  expiresAt: null,
} as never;

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
  let suggestionService: vi.Mocked<SuggestionService>;
  let feedbackService: vi.Mocked<FeedbackService>;
  let explanationService: vi.Mocked<ExplanationService>;
  let lifecycleService: vi.Mocked<LifecycleService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TodaySuggestionController],
      providers: [
        {
          provide: SuggestionService,
          useValue: {
            generate: vi.fn(),
            readCurrent: vi.fn(),
          },
        },
        {
          provide: FeedbackService,
          useValue: {
            recordFeedback: vi.fn(),
          },
        },
        {
          provide: ExplanationService,
          useValue: {
            explain: vi.fn(),
          },
        },
        {
          provide: ExplanationQueueService,
          useValue: {
            isConfigured: false,
            enqueue: vi.fn(),
            getStatus: vi.fn(),
          },
        },
        {
          provide: LifecycleService,
          useValue: {
            getHistory: vi.fn(),
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
    vi.restoreAllMocks();
  });

  describe('GET /today/suggestions', () => {
    it('returns suggestions envelope with no excludeIds', async () => {
      suggestionService.readCurrent.mockResolvedValue(
        mockSuggestionsData as never,
      );

      const result = await controller.getSuggestions(mockUser);

      expect(suggestionService.readCurrent).toHaveBeenCalledWith(
        mockUser.sub,
        undefined,
        [],
        { locale: 'zh-CN' },
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: mockSuggestionsData,
      });
    });

    it('passes date and single excludeIds as array', async () => {
      suggestionService.readCurrent.mockResolvedValue(
        mockSuggestionsData as never,
      );

      await controller.getSuggestions(mockUser, '2026-07-10', 'sug-dismissed');

      expect(suggestionService.readCurrent).toHaveBeenCalledWith(
        mockUser.sub,
        '2026-07-10',
        ['sug-dismissed'],
        { locale: 'zh-CN' },
      );
    });

    it('passes array excludeIds as-is', async () => {
      suggestionService.readCurrent.mockResolvedValue(
        mockSuggestionsData as never,
      );

      await controller.getSuggestions(mockUser, undefined, ['sug-1', 'sug-2']);

      expect(suggestionService.readCurrent).toHaveBeenCalledWith(
        mockUser.sub,
        undefined,
        ['sug-1', 'sug-2'],
        { locale: 'zh-CN' },
      );
    });
  });

  describe('POST /today/suggestions/:id/feedback', () => {
    it('records feedback and returns envelope', async () => {
      feedbackService.recordFeedback.mockResolvedValue(mockFeedbackResult);

      const result = await controller.submitFeedback(mockUser, 'sug-1', {
        feedback: 'accepted' as never,
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
          feedback: 'accepted' as never,
          appliedEffect: 'boosted_type',
        },
      });
    });

    it('includes expiresAt in response when present', async () => {
      feedbackService.recordFeedback.mockResolvedValue({
        ...(mockFeedbackResult as object),
        expiresAt: '2026-07-11T08:00:00.000Z',
      } as never);

      const result = await controller.submitFeedback(mockUser, 'sug-1', {
        feedback: 'later' as never,
      });

      expect(result.data).toHaveProperty(
        'expiresAt',
        '2026-07-11T08:00:00.000Z',
      );
    });

    it('omits expiresAt from response when null', async () => {
      feedbackService.recordFeedback.mockResolvedValue({
        ...(mockFeedbackResult as object),
        expiresAt: null,
      } as never);

      const result = await controller.submitFeedback(mockUser, 'sug-1', {
        feedback: 'accepted' as never,
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

  describe('POST /today/suggestions/:id/explain/async', () => {
    const queueAccess = () =>
      (
        controller as unknown as {
          explanationQueueService: {
            isConfigured: boolean;
            enqueue: ReturnType<typeof vi.fn>;
            getStatus: ReturnType<typeof vi.fn>;
          };
        }
      ).explanationQueueService;

    it('falls back to synchronous explain when the queue is not configured', async () => {
      explanationService.explain.mockResolvedValue(mockExplanationResult);

      const result = await controller.explainSuggestionAsync(
        mockUser,
        'sug-1',
        'zh-CN',
      );

      expect(explanationService.explain).toHaveBeenCalledWith(
        mockUser.sub,
        'sug-1',
        'zh-CN',
      );
      expect(result.data).toEqual({ result: mockExplanationResult });
    });

    it('returns a jobId when the queue is configured and enqueues', async () => {
      const queue = queueAccess();
      queue.isConfigured = true;
      queue.enqueue.mockResolvedValue('job-1');

      const result = await controller.explainSuggestionAsync(
        mockUser,
        'sug-1',
        'zh-CN',
      );

      expect(queue.enqueue).toHaveBeenCalledWith(
        mockUser.sub,
        'sug-1',
        'zh-CN',
      );
      expect(explanationService.explain).not.toHaveBeenCalled();
      expect(result.data).toEqual({ jobId: 'job-1' });
    });

    it('falls back when enqueue returns null', async () => {
      const queue = queueAccess();
      queue.isConfigured = true;
      queue.enqueue.mockResolvedValue(null);
      explanationService.explain.mockResolvedValue(mockExplanationResult);

      const result = await controller.explainSuggestionAsync(
        mockUser,
        'sug-1',
        'zh-CN',
      );

      expect(explanationService.explain).toHaveBeenCalled();
      expect(result.data).toEqual({ result: mockExplanationResult });
    });
  });

  describe('GET /today/suggestions/explain/status/:jobId', () => {
    const queueAccess = () =>
      (
        controller as unknown as {
          explanationQueueService: {
            getStatus: ReturnType<typeof vi.fn>;
          };
        }
      ).explanationQueueService;

    it('returns not_found for unknown jobs', async () => {
      queueAccess().getStatus.mockResolvedValue(null);

      const result = await controller.explainSuggestionStatus(
        mockUser,
        'job-1',
      );

      expect(queueAccess().getStatus).toHaveBeenCalledWith(
        'job-1',
        mockUser.sub,
      );
      expect(result.data).toEqual({ status: 'not_found' });
    });

    it('returns the job status when found', async () => {
      queueAccess().getStatus.mockResolvedValue({
        status: 'completed',
        jobId: 'job-1',
      });

      const result = await controller.explainSuggestionStatus(
        mockUser,
        'job-1',
      );

      expect(result.data).toEqual({
        status: 'completed',
        jobId: 'job-1',
      });
    });
  });

  describe('GET /today/suggestions/history', () => {
    it('returns history envelope with defaults when no query provided', async () => {
      lifecycleService.getHistory.mockResolvedValue(mockHistoryResult as never);

      const defaultDateSpy = vi
        .spyOn(LifecycleService, 'getDefaultStartDate')
        .mockReturnValue('2026-06-10');

      const result = await controller.getHistory(mockUser);

      const expectedEndDate = formatDateOnly(now());
      expect(lifecycleService.getHistory).toHaveBeenCalledWith(
        mockUser.sub,
        '2026-06-10',
        expectedEndDate,
        'zh-CN',
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

    it('passes explicit date range and locale to service', async () => {
      lifecycleService.getHistory.mockResolvedValue(mockHistoryResult as never);

      const result = await controller.getHistory(
        mockUser,
        '2026-06-01',
        '2026-07-01',
        undefined,
        undefined,
        undefined,
        'en-US',
      );

      expect(lifecycleService.getHistory).toHaveBeenCalledWith(
        mockUser.sub,
        '2026-06-01',
        '2026-07-01',
        'en-US',
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
        'zh-CN',
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
        'zh-CN',
        { type: 'trend' },
      );
    });
  });
});
