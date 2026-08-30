import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LlmRuntimeService } from '../../../../llm-runtime';
import type { MetricsService } from '../../../../common/metrics/metrics.service';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service';
import { AI_MODEL_TIMEOUT_MS } from '../../../../config/app-defaults.constants';
import { REPORT_RANGE_LAST_30_DAYS } from '../../dto/report-dashboard-query.dto';
import { ReportsAiSummaryGeneratorService } from './generator.service';
import type { ReportsAiSummaryContext } from './context.service';

function buildMetricsService() {
  return {
    recordLlmCall: vi.fn(),
    recordLlmTokens: vi.fn(),
    recordBullmqJob: vi.fn(),
    setBullmqActiveJobs: vi.fn(),
    setBullmqWaitingJobs: vi.fn(),
    recordHttpRequest: vi.fn(),
    is_enabled: vi.fn().mockReturnValue(true),
    getMetrics: vi.fn(),
    getContentType: vi.fn(),
  } as unknown as MetricsService;
}

const baseContext: ReportsAiSummaryContext = {
  range: REPORT_RANGE_LAST_30_DAYS,
  startDate: '2026-05-14',
  endDate: '2026-06-12',
  generatedAt: '2026-06-12T08:00:00.000Z',
  coverage: {
    medication: { trackedDays: 30, totalDays: 30 },
    water: { trackedDays: 30, totalDays: 30 },
    sleep: { trackedDays: 0, totalDays: 30 },
  },
  metrics: [
    {
      kind: 'medication' as const,
      value: '83',
      unit: '%',
      status: 'stable' as const,
      delta: '+17%',
      direction: 'up' as const,
    },
    {
      kind: 'water' as const,
      value: '1.5',
      unit: 'L',
      status: 'stable' as const,
      delta: '-0.3',
      direction: 'down' as const,
    },
    {
      kind: 'sleep' as const,
      value: '--',
      unit: 'h',
      status: 'insufficient_data' as const,
      delta: '--',
      direction: 'flat' as const,
    },
  ],
  series: {
    medication: Array<number>(30).fill(80),
    water: Array<number>(30).fill(1.6),
    sleep: Array<number>(30).fill(0),
    mealEstimate: Array<number>(30).fill(1),
  },
  mealEstimateBreakdown: {
    confirmedDays: 30,
    estimatedDays: 0,
    partialDays: 0,
    analyzingDays: 0,
    failedDays: 0,
  },
};

const basePromptCopy = {
  userIntro: 'intro',
  tone: 'tone',
  actionLabelHint: 'hint',
  factsLabel: 'facts',
};

const baseModelOutput = {
  summary: 'ok',
  coverage: {
    medication: { trackedDays: 30, totalDays: 30 },
    water: { trackedDays: 30, totalDays: 30 },
    sleep: { trackedDays: 0, totalDays: 30 },
  },
  observedPattern: {
    kind: 'medication' as const,
    text: '用药完成率连续 5 天保持在 80% 以上。',
    source: 'reminder_plan',
  },
  lowRiskAction: {
    label: '查看报告',
    text: '继续按当前节奏记录日常饮水量。',
  },
  disclaimer: '仅基于近 30 天已记录数据，不构成诊断或治疗建议。',
};

describe('ReportsAiSummaryGeneratorService', () => {
  it('delegates generation to llm runtime with structured output', async () => {
    const invoke = vi.fn().mockResolvedValue(baseModelOutput);
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
    const createChatModel = vi.fn().mockReturnValue({ withStructuredOutput });
    const service = new ReportsAiSummaryGeneratorService(
      {
        hasRoleConfig: vi.fn(),
        createChatModel,
        getModelName: vi.fn().mockReturnValue('test-model'),
      } as unknown as LlmRuntimeService,
      buildMetricsService(),
      new LlmCircuitBreakerService(),
    );

    const result = await service.generate(baseContext, basePromptCopy);

    expect(createChatModel).toHaveBeenCalledWith('analysis', {
      timeout: AI_MODEL_TIMEOUT_MS,
      temperature: 0.2,
      maxRetries: 0,
    });
    expect(withStructuredOutput).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith([
      expect.any(SystemMessage),
      expect.any(HumanMessage),
    ]);
    expect(result.summary).toBe('ok');
  });

  it('records error metric and rethrows when LLM invocation fails', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('LLM timeout'));
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
    const createChatModel = vi.fn().mockReturnValue({ withStructuredOutput });
    const metricsService = buildMetricsService();
    const service = new ReportsAiSummaryGeneratorService(
      {
        hasRoleConfig: vi.fn(),
        createChatModel,
        getModelName: vi.fn().mockReturnValue('test-model'),
      } as unknown as LlmRuntimeService,
      metricsService,
      new LlmCircuitBreakerService(),
    );

    await expect(
      service.generate(
        {
          ...baseContext,
          coverage: {
            medication: { trackedDays: 0, totalDays: 30 },
            water: { trackedDays: 0, totalDays: 30 },
            sleep: { trackedDays: 0, totalDays: 30 },
          },
          metrics: [],
        },
        basePromptCopy,
      ),
    ).rejects.toThrow('LLM timeout');

    expect(metricsService.recordLlmCall).toHaveBeenCalledWith(
      'analysis',
      'test-model',
      'error',
      expect.any(Number),
    );
  });

  it('records success metric with duration after successful generation', async () => {
    const invoke = vi.fn().mockResolvedValue(baseModelOutput);
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
    const createChatModel = vi.fn().mockReturnValue({ withStructuredOutput });
    const metricsService = buildMetricsService();
    const service = new ReportsAiSummaryGeneratorService(
      {
        hasRoleConfig: vi.fn(),
        createChatModel,
        getModelName: vi.fn().mockReturnValue('test-model'),
      } as unknown as LlmRuntimeService,
      metricsService,
      new LlmCircuitBreakerService(),
    );

    await service.generate(baseContext, basePromptCopy);

    expect(metricsService.recordLlmCall).toHaveBeenCalledWith(
      'analysis',
      'test-model',
      'success',
      expect.any(Number),
    );
    const durationArg = (metricsService.recordLlmCall as vi.Mock).mock
      .calls[0]![3];
    expect(typeof durationArg).toBe('number');
    expect(durationArg).toBeGreaterThanOrEqual(0);
  });

  it('delegates hasAnalysisModel to llmRuntimeService.hasRoleConfig', () => {
    const hasRoleConfig = vi.fn().mockReturnValue(true);
    const service = new ReportsAiSummaryGeneratorService(
      {
        hasRoleConfig,
        createChatModel: vi.fn(),
        getModelName: vi.fn(),
      } as unknown as LlmRuntimeService,
      buildMetricsService(),
      new LlmCircuitBreakerService(),
    );

    expect(service.hasAnalysisModel()).toBe(true);
    expect(hasRoleConfig).toHaveBeenCalledWith('analysis');
  });

  it('returns false from hasAnalysisModel when role is not configured', () => {
    const service = new ReportsAiSummaryGeneratorService(
      {
        hasRoleConfig: vi.fn().mockReturnValue(false),
        createChatModel: vi.fn(),
        getModelName: vi.fn(),
      } as unknown as LlmRuntimeService,
      buildMetricsService(),
      new LlmCircuitBreakerService(),
    );

    expect(service.hasAnalysisModel()).toBe(false);
  });
});
