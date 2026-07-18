import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LlmRuntimeService } from '../../../llm-runtime';
import type { MetricsService } from '../../../common/metrics/metrics.service';
import { LlmCircuitBreakerService } from '../../../common/llm/llm-circuit-breaker.service';
import { AI_MODEL_TIMEOUT_MS } from '../../../config/constants';
import { TodayAnalysisGeneratorService } from './generator.service';

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

describe('TodayAnalysisGeneratorService', () => {
  it('delegates generation to llm runtime with structured output', async () => {
    const invoke = vi.fn().mockResolvedValue({
      summary: 'ok',
      bullets: [
        { kind: 'general', text: 'a' },
        { kind: 'sleep', text: 'b' },
      ],
      actionLabel: 'View today',
      confidenceNote: 'Generated from records only.',
    });
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
    const createChatModel = vi.fn().mockReturnValue({ withStructuredOutput });
    const service = new TodayAnalysisGeneratorService(
      {
        hasRoleConfig: vi.fn(),
        createChatModel,
        getModelName: vi.fn().mockReturnValue('test-model'),
      } as unknown as LlmRuntimeService,
      buildMetricsService(),
      new LlmCircuitBreakerService(),
    );

    const result = await service.generate(
      {
        date: '2026-06-12',
        water: { completedCount: 4, targetCount: 8, remainingCount: 4 },
        medication: {
          medicineCount: 2,
          pendingCount: 1,
          nextDoseTimeLabel: '20:00',
          nextMedicineName: 'Vitamin B',
          currentMedicineNames: ['Vitamin B'],
        },
        recordSummary: [],
        recentRecords: [],
        sleep: {
          status: 'insufficient_data',
          durationMinutes: null,
          quality: null,
          startAt: null,
          endAt: null,
          deepMinutes: null,
          lightMinutes: null,
          remMinutes: null,
        },
        lowRiskContext: {
          activeAllergyCount: 0,
          currentMedicineCount: 2,
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
    const invoke = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
    const createChatModel = vi.fn().mockReturnValue({ withStructuredOutput });
    const metricsService = buildMetricsService();
    const service = new TodayAnalysisGeneratorService(
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
          date: '2026-06-12',
          water: { completedCount: 0, targetCount: 8, remainingCount: 8 },
          medication: {
            medicineCount: 0,
            pendingCount: 0,
            nextDoseTimeLabel: '',
            nextMedicineName: null,
            currentMedicineNames: [],
          },
          recordSummary: [],
          recentRecords: [],
          sleep: {
            status: 'insufficient_data',
            durationMinutes: null,
            quality: null,
            startAt: null,
            endAt: null,
            deepMinutes: null,
            lightMinutes: null,
            remMinutes: null,
          },
          lowRiskContext: {
            activeAllergyCount: 0,
            currentMedicineCount: 0,
          },
        },
        {
          userIntro: 'intro',
          tone: 'tone',
          actionLabelHint: 'hint',
          factsLabel: 'facts',
        },
      ),
    ).rejects.toThrow('LLM unavailable');

    expect(metricsService.recordLlmCall).toHaveBeenCalledWith(
      'analysis',
      'test-model',
      'error',
      expect.any(Number),
    );
  });

  it('records success metric with duration after successful generation', async () => {
    const invoke = vi.fn().mockResolvedValue({
      summary: 'ok',
      bullets: [],
      actionLabel: 'View',
      confidenceNote: 'note',
    });
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
    const createChatModel = vi.fn().mockReturnValue({ withStructuredOutput });
    const metricsService = buildMetricsService();
    const service = new TodayAnalysisGeneratorService(
      {
        hasRoleConfig: vi.fn(),
        createChatModel,
        getModelName: vi.fn().mockReturnValue('test-model'),
      } as unknown as LlmRuntimeService,
      metricsService,
      new LlmCircuitBreakerService(),
    );

    await service.generate(
      {
        date: '2026-06-12',
        water: { completedCount: 4, targetCount: 8, remainingCount: 4 },
        medication: {
          medicineCount: 1,
          pendingCount: 0,
          nextDoseTimeLabel: '',
          nextMedicineName: null,
          currentMedicineNames: ['Vitamin C'],
        },
        recordSummary: [],
        recentRecords: [],
        sleep: {
          status: 'insufficient_data',
          durationMinutes: null,
          quality: null,
          startAt: null,
          endAt: null,
          deepMinutes: null,
          lightMinutes: null,
          remMinutes: null,
        },
        lowRiskContext: {
          activeAllergyCount: 0,
          currentMedicineCount: 1,
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
    const durationArg = (metricsService.recordLlmCall as vi.Mock).mock
      .calls[0]![3];
    expect(typeof durationArg).toBe('number');
    expect(durationArg).toBeGreaterThanOrEqual(0);
  });

  it('delegates hasAnalysisModel to llmRuntimeService.hasRoleConfig', () => {
    const hasRoleConfig = vi.fn().mockReturnValue(true);
    const service = new TodayAnalysisGeneratorService(
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
    const service = new TodayAnalysisGeneratorService(
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
