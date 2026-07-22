import type { SuggestionCopyLlmService } from './copy-llm-generator.service';
import type { SuggestionCopyQueueService } from './copy-queue.service';
import type { SuggestionCacheService } from '../cache/suggestion-cache.service';
import { SuggestionCopyService } from './copy.service';
import { SuggestionType, SuggestionConfidence } from '../../types';
import type { CopyJobData } from '../../types/copy-generation.types';

function buildRequest(overrides: Partial<CopyJobData> = {}): CopyJobData {
  return {
    templateKey: 'water.behind.target',
    params: {
      completedCount: 2,
      targetCount: 8,
      remainingCount: 6,
      completionRate: 25,
      consecutiveDays: 3,
    },
    locale: 'zh-CN',
    tone: 'gentle',
    suggestionType: SuggestionType.BEHAVIOR_ADVICE,
    confidence: SuggestionConfidence.MEDIUM,
    ruleId: 'water_behind_target',
    subtype: 'water',
    evidence: [
      { kind: 'record', label: '当前杯数', value: '2 杯' },
      { kind: 'record', label: '目标杯数', value: '8 杯' },
    ],
    originalTitle: '今日饮水还差 6 杯',
    originalReason: '今日已记录 2 杯',
    originalBoundary: '饮水建议仅供参考',
    ...overrides,
  };
}

describe('SuggestionCopyService', () => {
  let llmServiceMock: {
    hasAnalysisModel: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
  };
  let cacheMock: {
    getCopy: ReturnType<typeof vi.fn>;
    setCopy: ReturnType<typeof vi.fn>;
  };
  let queueMock: {
    isConfigured: boolean;
    enqueue: ReturnType<typeof vi.fn>;
  };
  let service: SuggestionCopyService;

  const generatedCopy = {
    title: '今日饮水还差 6 杯',
    reason: '目前已记录 2 杯，距离目标还有 6 杯。',
    boundary: '饮水建议仅供参考，请根据个人情况调整。',
    actionLabel: '去记录',
  };

  beforeEach(() => {
    llmServiceMock = {
      hasAnalysisModel: vi.fn().mockReturnValue(true),
      generate: vi.fn().mockResolvedValue(generatedCopy),
    };
    cacheMock = {
      getCopy: vi.fn().mockResolvedValue(undefined),
      setCopy: vi.fn().mockResolvedValue(undefined),
    };
    queueMock = {
      isConfigured: true,
      enqueue: vi.fn().mockResolvedValue('job-1'),
    };

    service = new SuggestionCopyService(
      llmServiceMock as unknown as SuggestionCopyLlmService,
      cacheMock as unknown as SuggestionCacheService,
      queueMock as unknown as SuggestionCopyQueueService,
    );
  });

  // ─── getOrEnqueue (read path) ───

  describe('getOrEnqueue', () => {
    it('returns cached AI copy on cache hit', async () => {
      cacheMock.getCopy.mockResolvedValue(generatedCopy);

      const result = await service.getOrEnqueue(buildRequest());

      expect(result.aiGenerated).toBe(true);
      expect(result.fromCache).toBe(true);
      expect(result.title).toBe(generatedCopy.title);
      expect(queueMock.enqueue).not.toHaveBeenCalled();
    });

    it('returns fallback and enqueues on cache miss when queue is configured', async () => {
      const result = await service.getOrEnqueue(buildRequest());

      expect(result.aiGenerated).toBe(false);
      expect(result.fromCache).toBe(false);
      expect(queueMock.enqueue).toHaveBeenCalledTimes(1);

      const enqueuedData = queueMock.enqueue.mock.calls[0]![0];
      expect(enqueuedData.templateKey).toBe('water.behind.target');
      expect(enqueuedData.suggestionType).toBe(SuggestionType.BEHAVIOR_ADVICE);
      expect(enqueuedData.confidence).toBe(SuggestionConfidence.MEDIUM);
      expect(enqueuedData.evidence).toHaveLength(2);
      expect(enqueuedData.originalTitle).toBe('今日饮水还差 6 杯');
    });

    it('returns fallback without enqueuing when queue is not configured', async () => {
      queueMock.isConfigured = false;

      const result = await service.getOrEnqueue(buildRequest());

      expect(result.aiGenerated).toBe(false);
      expect(queueMock.enqueue).not.toHaveBeenCalled();
    });

    it('returns fallback for invalid template params', async () => {
      const result = await service.getOrEnqueue(
        buildRequest({ templateKey: 'nonexistent.template' }),
      );

      expect(result.aiGenerated).toBe(false);
      expect(queueMock.enqueue).not.toHaveBeenCalled();
    });
  });

  // ─── generateViaLlm (write path) ───

  describe('generateViaLlm', () => {
    it('returns cached copy on second cache check (deduplication)', async () => {
      cacheMock.getCopy.mockResolvedValue(generatedCopy);

      const result = await service.generateViaLlm({
        templateKey: 'water.behind.target',
        params: { completedCount: 2, targetCount: 8 },
        locale: 'zh-CN',
        tone: 'gentle',
        suggestionType: SuggestionType.BEHAVIOR_ADVICE,
        confidence: SuggestionConfidence.MEDIUM,
        ruleId: 'water_behind_target',
        subtype: 'water',
        evidence: [],
        originalTitle: 'title',
        originalReason: 'reason',
        originalBoundary: 'boundary',
      });

      expect(result.fromCache).toBe(true);
      expect(llmServiceMock.generate).not.toHaveBeenCalled();
    });

    it('calls LLM and stores result in cache on miss', async () => {
      const result = await service.generateViaLlm({
        templateKey: 'water.behind.target',
        params: { completedCount: 2, targetCount: 8 },
        locale: 'zh-CN',
        tone: 'gentle',
        suggestionType: SuggestionType.BEHAVIOR_ADVICE,
        confidence: SuggestionConfidence.MEDIUM,
        ruleId: 'water_behind_target',
        subtype: 'water',
        evidence: [],
        originalTitle: 'title',
        originalReason: 'reason',
        originalBoundary: 'boundary',
      });

      expect(result.aiGenerated).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(llmServiceMock.generate).toHaveBeenCalledTimes(1);
      expect(cacheMock.setCopy).toHaveBeenCalledTimes(1);
    });

    it('returns fallback when LLM is not configured', async () => {
      llmServiceMock.hasAnalysisModel.mockReturnValue(false);

      const result = await service.generateViaLlm({
        templateKey: 'water.behind.target',
        params: { completedCount: 2, targetCount: 8 },
        locale: 'zh-CN',
        suggestionType: SuggestionType.BEHAVIOR_ADVICE,
        confidence: SuggestionConfidence.MEDIUM,
        ruleId: 'water_behind_target',
        evidence: [],
        originalTitle: 'title',
        originalReason: 'reason',
        originalBoundary: 'boundary',
      });

      expect(result.aiGenerated).toBe(false);
      expect(llmServiceMock.generate).not.toHaveBeenCalled();
    });
  });

  // ─── generateSync (fallback path) ───

  describe('generateSync', () => {
    it('returns cached copy on cache hit', async () => {
      cacheMock.getCopy.mockResolvedValue(generatedCopy);

      const result = await service.generateSync(buildRequest());

      expect(result.aiGenerated).toBe(true);
      expect(result.fromCache).toBe(true);
      expect(llmServiceMock.generate).not.toHaveBeenCalled();
    });

    it('calls LLM and stores result in cache on miss', async () => {
      const result = await service.generateSync(buildRequest());

      expect(result.aiGenerated).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(llmServiceMock.generate).toHaveBeenCalledTimes(1);
      expect(cacheMock.setCopy).toHaveBeenCalledTimes(1);

      // Verify full context is passed to LLM
      const generateCall = llmServiceMock.generate.mock.calls[0]!;
      const context = generateCall[0];
      expect(context.suggestionType).toBe(SuggestionType.BEHAVIOR_ADVICE);
      expect(context.evidence).toHaveLength(2);
    });

    it('returns fallback when LLM is not configured', async () => {
      llmServiceMock.hasAnalysisModel.mockReturnValue(false);

      const result = await service.generateSync(buildRequest());

      expect(result.aiGenerated).toBe(false);
      expect(llmServiceMock.generate).not.toHaveBeenCalled();
    });

    it('returns fallback when LLM throws', async () => {
      llmServiceMock.generate.mockRejectedValue(new Error('LLM timeout'));

      const result = await service.generateSync(buildRequest());

      expect(result.aiGenerated).toBe(false);
    });
  });
});
