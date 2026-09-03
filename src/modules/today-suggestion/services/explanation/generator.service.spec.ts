import type { LlmRuntimePort } from '../../../../common/llm/llm-runtime.port.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import type { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import type { MetricsService } from '../../../../common/metrics/metrics.service.js';
import {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from '../../types/suggestion.types.js';
import type {
  ExplanationContext,
  ExplanationPromptCopy,
} from '../../prompts/explanation.prompt.js';
import { ExplanationGeneratorService } from './generator.service.js';

describe('ExplanationGeneratorService', () => {
  let service: ExplanationGeneratorService;
  let llmRuntimeMock: vi.Mocked<LlmRuntimePort>;
  let metricsMock: vi.Mocked<MetricsService>;

  const mockContext: ExplanationContext = {
    suggestionType: SuggestionType.TREND,
    triggerType: TriggerType.TIMER,
    confidence: SuggestionConfidence.MEDIUM,
    title: '症状恶化趋势',
    ruleId: 'deteriorating_trend',
    subtype: 'headache',
    evidence: [{ kind: 'trend', label: '最近7天严重度', value: '3→5→7' }],
    originalReason: '规则生成的原始原因',
    originalBoundary: '规则生成的原始边界',
  };

  const mockPromptCopy: ExplanationPromptCopy = {
    userIntro: '请根据以下信息生成解释',
    tone: '温和、简洁',
    constraints: '不要诊断、不要修改用药',
    factsLabel: '证据列表：',
  };

  const createService = (hasRoleConfig = true) => {
    const structuredModel = {
      invoke: vi.fn().mockResolvedValue({
        reason: 'AI生成的解释',
        boundary: 'AI生成的边界',
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

    service = new ExplanationGeneratorService(
      llmRuntimeMock as unknown as LlmRuntimeService,
      metricsMock,
      new LlmCircuitBreakerService(),
    );
    return { service, structuredModel, streamingModel };
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
      expect(result).toEqual({
        reason: 'AI生成的解释',
        boundary: 'AI生成的边界',
      });
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
