import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LlmRuntimeService } from '../../../../llm-runtime/services/llm-runtime.service';
import type { MetricsService } from '../../../../common/metrics/metrics.service';
import { AI_MODEL_TIMEOUT_MS } from '../../../../config/constants';
import { REPORT_RANGE_LAST_30_DAYS } from '../../dto';
import { ReportsAiSummaryGeneratorService } from './generator.service';

function buildMetricsService() {
  return {
    recordLlmCall: jest.fn(),
    recordLlmTokens: jest.fn(),
    recordBullmqJob: jest.fn(),
    setBullmqActiveJobs: jest.fn(),
    setBullmqWaitingJobs: jest.fn(),
    recordHttpRequest: jest.fn(),
    is_enabled: jest.fn().mockReturnValue(true),
    getMetrics: jest.fn(),
    getContentType: jest.fn(),
  } as unknown as MetricsService;
}

describe('ReportsAiSummaryGeneratorService', () => {
  it('delegates generation to llm runtime with structured output', async () => {
    const invoke = jest.fn().mockResolvedValue({
      summary: 'ok',
      bullets: [
        { kind: 'general', text: 'a' },
        { kind: 'sleep', text: 'b' },
      ],
      actionLabel: 'View report',
      confidenceNote: 'Generated from records only.',
    });
    const withStructuredOutput = jest.fn().mockReturnValue({ invoke });
    const createChatModel = jest.fn().mockReturnValue({ withStructuredOutput });
    const service = new ReportsAiSummaryGeneratorService(
      {
        hasRoleConfig: jest.fn(),
        createChatModel,
        getModelName: jest.fn().mockReturnValue('test-model'),
      } as unknown as LlmRuntimeService,
      buildMetricsService(),
    );

    const result = await service.generate(
      {
        range: REPORT_RANGE_LAST_30_DAYS,
        startDate: '2026-05-14',
        endDate: '2026-06-12',
        generatedAt: '2026-06-12T08:00:00.000Z',
        score: {
          value: 78,
          maxValue: 100,
          status: 'stable',
        },
        metrics: [
          {
            kind: 'medication',
            value: '83',
            unit: '%',
            status: 'stable',
            delta: '+17%',
            direction: 'up',
          },
          {
            kind: 'water',
            value: '1.5',
            unit: 'L',
            status: 'stable',
            delta: '-0.3',
            direction: 'down',
          },
          {
            kind: 'sleep',
            value: '--',
            unit: 'h',
            status: 'insufficient_data',
            delta: '--',
            direction: 'flat',
          },
        ],
        series: {
          medication: Array<number>(30).fill(80),
          water: Array<number>(30).fill(1.6),
          sleep: Array<number>(30).fill(0),
          mealEstimate: Array<number>(30).fill(1),
        },
        dataQuality: {
          medicationTrackedDays: 30,
          waterTrackedDays: 30,
          sleepTrackedDays: 0,
          mealEstimateTrackedDays: 30,
        },
        mealEstimateBreakdown: {
          confirmedDays: 30,
          estimatedDays: 0,
          partialDays: 0,
          analyzingDays: 0,
          failedDays: 0,
        },
      },
      {
        userIntro: 'intro',
        tone: 'tone',
        actionLabelHint: 'hint',
        factsLabel: 'facts',
      },
    );

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
    const invoke = jest.fn().mockRejectedValue(new Error('LLM timeout'));
    const withStructuredOutput = jest.fn().mockReturnValue({ invoke });
    const createChatModel = jest.fn().mockReturnValue({ withStructuredOutput });
    const metricsService = buildMetricsService();
    const service = new ReportsAiSummaryGeneratorService(
      {
        hasRoleConfig: jest.fn(),
        createChatModel,
        getModelName: jest.fn().mockReturnValue('test-model'),
      } as unknown as LlmRuntimeService,
      metricsService,
    );

    await expect(
      service.generate(
        {
          range: REPORT_RANGE_LAST_30_DAYS,
          startDate: '2026-05-14',
          endDate: '2026-06-12',
          generatedAt: '2026-06-12T08:00:00.000Z',
          score: {
            value: 50,
            maxValue: 100,
            status: 'stable',
          },
          metrics: [],
          series: {
            medication: [],
            water: [],
            sleep: [],
            mealEstimate: [],
          },
          dataQuality: {
            medicationTrackedDays: 0,
            waterTrackedDays: 0,
            sleepTrackedDays: 0,
            mealEstimateTrackedDays: 0,
          },
          mealEstimateBreakdown: {
            confirmedDays: 0,
            estimatedDays: 0,
            partialDays: 0,
            analyzingDays: 0,
            failedDays: 0,
          },
        },
        {
          userIntro: 'intro',
          tone: 'tone',
          actionLabelHint: 'hint',
          factsLabel: 'facts',
        },
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
    const invoke = jest.fn().mockResolvedValue({
      summary: 'ok',
      bullets: [],
      actionLabel: 'View',
      confidenceNote: 'note',
    });
    const withStructuredOutput = jest.fn().mockReturnValue({ invoke });
    const createChatModel = jest.fn().mockReturnValue({ withStructuredOutput });
    const metricsService = buildMetricsService();
    const service = new ReportsAiSummaryGeneratorService(
      {
        hasRoleConfig: jest.fn(),
        createChatModel,
        getModelName: jest.fn().mockReturnValue('test-model'),
      } as unknown as LlmRuntimeService,
      metricsService,
    );

    await service.generate(
      {
        range: REPORT_RANGE_LAST_30_DAYS,
        startDate: '2026-05-14',
        endDate: '2026-06-12',
        generatedAt: '2026-06-12T08:00:00.000Z',
        score: { value: 50, maxValue: 100, status: 'stable' },
        metrics: [],
        series: { medication: [], water: [], sleep: [], mealEstimate: [] },
        dataQuality: {
          medicationTrackedDays: 0,
          waterTrackedDays: 0,
          sleepTrackedDays: 0,
          mealEstimateTrackedDays: 0,
        },
        mealEstimateBreakdown: {
          confirmedDays: 0,
          estimatedDays: 0,
          partialDays: 0,
          analyzingDays: 0,
          failedDays: 0,
        },
      },
      {
        userIntro: 'intro',
        tone: 'tone',
        actionLabelHint: 'hint',
        factsLabel: 'facts',
      },
    );

    expect(metricsService.recordLlmCall).toHaveBeenCalledWith(
      'analysis',
      'test-model',
      'success',
      expect.any(Number),
    );
    const durationArg = (metricsService.recordLlmCall as jest.Mock).mock
      .calls[0][3];
    expect(typeof durationArg).toBe('number');
    expect(durationArg).toBeGreaterThanOrEqual(0);
  });

  it('delegates hasAnalysisModel to llmRuntimeService.hasRoleConfig', () => {
    const hasRoleConfig = jest.fn().mockReturnValue(true);
    const service = new ReportsAiSummaryGeneratorService(
      {
        hasRoleConfig,
        createChatModel: jest.fn(),
        getModelName: jest.fn(),
      } as unknown as LlmRuntimeService,
      buildMetricsService(),
    );

    expect(service.hasAnalysisModel()).toBe(true);
    expect(hasRoleConfig).toHaveBeenCalledWith('analysis');
  });

  it('returns false from hasAnalysisModel when role is not configured', () => {
    const service = new ReportsAiSummaryGeneratorService(
      {
        hasRoleConfig: jest.fn().mockReturnValue(false),
        createChatModel: jest.fn(),
        getModelName: jest.fn(),
      } as unknown as LlmRuntimeService,
      buildMetricsService(),
    );

    expect(service.hasAnalysisModel()).toBe(false);
  });
});
