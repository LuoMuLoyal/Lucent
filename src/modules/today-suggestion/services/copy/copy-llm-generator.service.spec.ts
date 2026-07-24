import type { LlmRuntimePort } from '../../../../common/llm/llm-runtime.port';
import { LlmCircuitBreakerService } from '../../../../common/llm/llm-circuit-breaker.service';
import type { LlmRuntimeService } from '../../../../llm-runtime';
import type { MetricsService } from '../../../../common/metrics/metrics.service';
import {
  SuggestionType,
  SuggestionConfidence,
} from '../../types/suggestion.types';
import type {
  CopyGenerationContext,
  CopyPromptCopy,
} from '../../types/copy-generation.types';
import { SuggestionCopyLlmService } from './copy-llm-generator.service';

describe('SuggestionCopyLlmService', () => {
  let service: SuggestionCopyLlmService;
  let llmRuntimeMock: vi.Mocked<LlmRuntimePort>;
  let metricsMock: vi.Mocked<MetricsService>;

  const mockContext: CopyGenerationContext = {
    templateKey: 'water.behind.target',
    params: { completedCount: 2, targetCount: 8, remainingCount: 6 },
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
  };

  const mockPromptCopy: CopyPromptCopy = {
    tone: 'gentle',
    userIntro: '请为以下健康建议卡生成更自然的中文文案。',
    constraints: '只能基于提供的参数生成内容，不得虚构数据。',
    factsLabel: 'Suggestion context:',
  };

  const createService = (hasRoleConfig = true) => {
    const structuredModel = {
      invoke: vi.fn().mockResolvedValue({
        title: '今日饮水还差 6 杯',
        reason: '目前已记录 2 杯，距离目标还有 6 杯。',
        boundary: '饮水建议仅供参考，请根据个人情况调整。',
        actionLabel: '去记录',
      }),
    };
    const streamingModel = {
      stream: vi.fn(),
      withConfig: vi.fn().mockReturnThis(),
    };

    llmRuntimeMock = {
      hasRoleConfig: vi.fn().mockReturnValue(hasRoleConfig),
      createChatModel: vi.fn().mockReturnValue({
        withStructuredOutput: vi.fn().mockReturnValue(structuredModel),
        withConfig: vi.fn().mockReturnValue(streamingModel),
      }),
      getModelName: vi.fn().mockReturnValue('gpt-4o-mini'),
    } as unknown as vi.Mocked<LlmRuntimePort>;

    metricsMock = {
      recordLlmCall: vi.fn(),
    } as unknown as vi.Mocked<MetricsService>;

    service = new SuggestionCopyLlmService(
      llmRuntimeMock as unknown as LlmRuntimeService,
      metricsMock,
      new LlmCircuitBreakerService(),
    );
    return { service, structuredModel };
  };

  describe('hasAnalysisModel', () => {
    it('returns true when language role is configured', () => {
      const { service } = createService(true);
      expect(service.hasAnalysisModel()).toBe(true);
      expect(llmRuntimeMock.hasRoleConfig).toHaveBeenCalledWith('language');
    });

    it('returns false when language role is not configured', () => {
      const { service } = createService(false);
      expect(service.hasAnalysisModel()).toBe(false);
    });
  });

  describe('generate', () => {
    it('invokes the structured-output model and returns parsed result', async () => {
      const { service, structuredModel } = createService(true);

      const result = await service.generate(mockContext, mockPromptCopy);

      expect(structuredModel.invoke).toHaveBeenCalledTimes(1);
      expect(result.title).toBe('今日饮水还差 6 杯');
      expect(result.reason).toContain('2 杯');
      expect(result.boundary).toContain('仅供参考');
      expect(result.actionLabel).toBe('去记录');
    });

    it('records a success metric after generate', async () => {
      const { service } = createService(true);

      await service.generate(mockContext, mockPromptCopy);

      expect(metricsMock.recordLlmCall).toHaveBeenCalledWith(
        'language',
        'gpt-4o-mini',
        'success',
        expect.any(Number),
      );
    });

    it('records an error metric and rethrows on failure', async () => {
      const { service, structuredModel } = createService(true);
      structuredModel.invoke.mockRejectedValue(new Error('LLM timeout'));

      await expect(
        service.generate(mockContext, mockPromptCopy),
      ).rejects.toThrow('LLM timeout');

      expect(metricsMock.recordLlmCall).toHaveBeenCalledWith(
        'language',
        'gpt-4o-mini',
        'error',
        expect.any(Number),
      );
    });

    it('passes system + user messages to the model', async () => {
      const { service, structuredModel } = createService(true);

      await service.generate(mockContext, mockPromptCopy);

      const messages = structuredModel.invoke.mock.calls[0]![0] as unknown[];
      expect(messages).toHaveLength(2);
    });
  });
});
