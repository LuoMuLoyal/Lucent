import { DomainFailureException } from '../../../../common/result/domain-failure.exception.js';
import type { LlmConfig } from '../../../../config/services/llm.config.js';
import {
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
} from '../../dto/report-dashboard-query.dto.js';
import type { ReportsAiSummaryContextService } from './context.service.js';
import type { ReportsLlmSummaryCopyService } from './copy.service.js';
import type { ReportsAiSummaryGeneratorService } from './generator.service.js';
import { LlmSafetyPolicyService } from '../../../../common/llm/safety/llm-safety-policy.service.js';
import { ReportsAiSummaryService } from './summary.service.js';
import { okAsync } from '../../../../common/result/index.js';
import type { ReportsComputationService } from '../../dashboard/computation.service.js';
import type { ReportsContextService } from '../../dashboard/context.service.js';

function modelGenerateSpy(service: ReportsAiSummaryService) {
  return vi.spyOn(
    (
      service as unknown as {
        generatorService: { generate: vi.Mock };
      }
    ).generatorService,
    'generate',
  );
}

describe('ReportsAiSummaryService', () => {
  const baseConfig: LlmConfig = {
    provider: 'openai-compatible',
    analysis: {
      apiKey: 'analysis-key',
      baseUrl: 'https://example.com/v1',
      model: 'analysis-model',
    },
    vision: { apiKey: null, baseUrl: null, model: null },
    language: { apiKey: null, baseUrl: null, model: null },
    chat: { apiKey: null, baseUrl: null, model: null },
    chatCompression: { apiKey: null, baseUrl: null, model: null },
    embedding: { apiKey: null, baseUrl: null, model: null },
    safety: { forbiddenPatterns: [] },
  };

  const baseFacts = {
    range: REPORT_RANGE_LAST_7_DAYS,
    startDate: new Date('2026-06-06T00:00:00.000Z'),
    endDate: new Date('2026-06-12T00:00:00.000Z'),
    generatedAt: '2026-06-12T08:00:00.000Z',
    aiSummaryEnabled: true,
    medicationSeries: [100, 50, 100, 0, 100, 50, 100],
    waterSeries: [1.8, 1.4, 1.7, 1.2, 1.6, 1.1, 1.5],
    sleepSeries: [0, 0, 0, 0, 0, 0, 0],
    mealEstimateSeries: [1, 1, 0, 1, 0, 0, 1],
    mealEstimateTrackedDays: 4,
    mealEstimateBreakdown: {
      confirmedDays: 2,
      estimatedDays: 2,
      partialDays: 1,
      analyzingDays: 0,
      failedDays: 0,
    },
  };

  const baseComputed = {
    score: {
      value: 78,
      maxValue: 100,
      status: 'stable' as const,
      summary: '本周记录较完整。',
    },
    metrics: [
      {
        kind: 'medication' as const,
        value: '83',
        unit: '%',
        status: 'stable' as const,
        delta: '+17%',
        direction: 'up' as const,
        sparkline: baseFacts.medicationSeries,
      },
      {
        kind: 'water' as const,
        value: '1.5',
        unit: 'L',
        status: 'stable' as const,
        delta: '-0.3',
        direction: 'down' as const,
        sparkline: baseFacts.waterSeries,
      },
      {
        kind: 'sleep' as const,
        value: '--',
        unit: 'h',
        status: 'insufficient_data' as const,
        delta: '--',
        direction: 'flat' as const,
        sparkline: baseFacts.sleepSeries,
      },
    ],
    trends: [],
    findings: [],
    patterns: [],
  };

  const baseAiContext = {
    range: REPORT_RANGE_LAST_7_DAYS,
    startDate: '2026-06-06',
    endDate: '2026-06-12',
    generatedAt: '2026-06-12T08:00:00.000Z',
    coverage: {
      medication: { trackedDays: 6, totalDays: 7 },
      water: { trackedDays: 7, totalDays: 7 },
      sleep: { trackedDays: 0, totalDays: 7 },
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
      medication: baseFacts.medicationSeries,
      water: baseFacts.waterSeries,
      sleep: baseFacts.sleepSeries,
      mealEstimate: baseFacts.mealEstimateSeries,
    },
    mealEstimateBreakdown: {
      confirmedDays: 2,
      estimatedDays: 2,
      partialDays: 1,
      analyzingDays: 0,
      failedDays: 0,
    },
  };

  it('returns model output when policy accepts it', async () => {
    const service = createService();
    const modelOutput = {
      summary: '近 7 天用药记录整体稳定，饮水连续性一般，睡眠仍缺少真实记录。',
      coverage: baseAiContext.coverage,
      observedPattern: {
        kind: 'medication' as const,
        text: '用药完成率连续 5 天保持在 80% 以上。',
        source: 'reminder_plan',
      },
      lowRiskAction: {
        label: '查看报告',
        text: '继续按当前节奏记录日常饮水量。',
      },
      disclaimer: '仅基于近 7 天已记录数据，不构成诊断或治疗建议。',
    };

    modelGenerateSpy(service).mockResolvedValue(modelOutput);

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'zh-CN',
    );

    expect(result.summary).toBe(modelOutput.summary);
    expect(result.observedPattern).toEqual(modelOutput.observedPattern);
  });

  it('falls back when policy rejects the model output', async () => {
    const service = createService();
    modelGenerateSpy(service).mockResolvedValue({
      summary: '建议停药并调整剂量。',
      coverage: baseAiContext.coverage,
      observedPattern: {
        kind: 'medication',
        text: '建议停药后观察。',
        source: 'reminder_plan',
      },
      lowRiskAction: {
        label: '查看报告',
        text: '可以先多喝水。',
      },
      disclaimer: '仅供参考。',
    });

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'zh-CN',
    );

    expect(result.summary).toContain('近');
    expect(result.observedPattern).not.toBeNull();
  });

  it('falls back when the model invocation throws', async () => {
    const service = createService();
    modelGenerateSpy(service).mockRejectedValue(new Error('model failed'));

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'zh-CN',
    );

    expect(result.disclaimer).toContain('近 7 天');
    expect(result.coverage).toEqual(baseAiContext.coverage);
  });

  it('falls back in English when requested language is English', async () => {
    const service = createService();
    modelGenerateSpy(service).mockRejectedValue(new Error('model failed'));

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'en-US',
    );

    expect(result.disclaimer).toContain('last 7 days');
  });

  it('rejects when ai summaries are disabled by user setting', async () => {
    const service = createService({
      userSettingValue: false,
    });

    await expect(
      service.generate('u1', { range: REPORT_RANGE_LAST_7_DAYS }, 'zh-CN'),
    ).rejects.toBeInstanceOf(DomainFailureException);
  });

  it('falls back when analysis model config is missing', async () => {
    const service = createService({
      config: {
        ...baseConfig,
        analysis: {
          apiKey: null,
          baseUrl: null,
          model: null,
        },
      },
    });

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'zh-CN',
    );

    expect(result.summary).toContain('近');
    expect(result.disclaimer).toContain('近 7 天');
  });

  it('passes 30-day range through and returns monthly fallback copy', async () => {
    const service = createService({
      facts: {
        ...baseFacts,
        range: REPORT_RANGE_LAST_30_DAYS,
        startDate: new Date('2026-05-14T00:00:00.000Z'),
        medicationSeries: Array<number>(30).fill(100),
        waterSeries: Array<number>(30).fill(1.6),
        sleepSeries: Array<number>(30).fill(0),
        mealEstimateSeries: Array<number>(30).fill(1),
        mealEstimateTrackedDays: 30,
        mealEstimateBreakdown: {
          confirmedDays: 30,
          estimatedDays: 0,
          partialDays: 0,
          analyzingDays: 0,
          failedDays: 0,
        },
      },
      context: {
        ...baseAiContext,
        range: REPORT_RANGE_LAST_30_DAYS,
        startDate: '2026-05-14',
        coverage: {
          medication: { trackedDays: 30, totalDays: 30 },
          water: { trackedDays: 30, totalDays: 30 },
          sleep: { trackedDays: 0, totalDays: 30 },
        },
        series: {
          medication: Array<number>(30).fill(100),
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
      },
    });

    modelGenerateSpy(service).mockRejectedValue(new Error('model failed'));

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_30_DAYS },
      'zh-CN',
    );

    expect(result.range).toBe(REPORT_RANGE_LAST_30_DAYS);
    expect(result.startDate).toBe('2026-05-14');
    expect(result.disclaimer).toContain('近 30 天');
  });

  it('abstains when all three dimensions have zero tracked days', async () => {
    const service = createService({
      facts: {
        ...baseFacts,
        medicationSeries: [0, 0, 0, 0, 0, 0, 0],
        waterSeries: [0, 0, 0, 0, 0, 0, 0],
        sleepSeries: [0, 0, 0, 0, 0, 0, 0],
      },
      context: {
        ...baseAiContext,
        coverage: {
          medication: { trackedDays: 0, totalDays: 7 },
          water: { trackedDays: 0, totalDays: 7 },
          sleep: { trackedDays: 0, totalDays: 7 },
        },
      },
    });

    modelGenerateSpy(service).mockRejectedValue(new Error('model failed'));

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'zh-CN',
    );

    expect(result.observedPattern).toBeNull();
    expect(result.lowRiskAction).toBeNull();
    expect(result.summary).toContain('暂不生成');
  });

  function createService(options?: {
    userSettingValue?: boolean;
    config?: LlmConfig;
    facts?: typeof baseFacts;
    context?: typeof baseAiContext;
  }) {
    const prisma = {
      userSetting: {
        findFirst: vi.fn().mockResolvedValue({
          value: options?.userSettingValue ?? true,
        }),
      },
    };
    const aiSummaryHistoryService = {
      save: vi.fn().mockReturnValue(okAsync(undefined)),
    };

    const reportsContextService = {
      build: vi.fn().mockResolvedValue(options?.facts ?? baseFacts),
    } as unknown as ReportsContextService;
    const reportsComputationService = {
      compute: vi.fn().mockReturnValue(baseComputed),
    } as unknown as ReportsComputationService;
    const reportsAiSummaryContextService = {
      build: vi.fn().mockReturnValue(options?.context ?? baseAiContext),
    } as unknown as ReportsAiSummaryContextService;
    const reportsLlmSummaryCopyService = {
      resolveLocale: vi.fn((language: string | undefined) => {
        const normalized = language?.trim().toLowerCase() ?? '';
        return normalized.startsWith('zh') ? 'zh-CN' : 'en';
      }),
      serviceUnavailable: vi.fn((locale: string) =>
        locale === 'zh-CN'
          ? '周报 AI 总结服务尚未配置'
          : 'Weekly report AI summary is not configured',
      ),
      summariesDisabled: vi.fn((locale: string) =>
        locale === 'zh-CN'
          ? '该用户已关闭 AI 总结'
          : 'AI summaries are disabled for this user',
      ),
      buildPromptCopy: vi.fn((locale: string) => ({
        userIntro:
          locale === 'zh-CN'
            ? '请基于提供的 JSON 事实生成一段简短的中文纵向健康洞察总结。'
            : 'Generate a brief English longitudinal health insight for the supplied JSON facts.',
        tone:
          locale === 'zh-CN'
            ? '语气保持平静、具体，不要做诊断。数据不足时直接弃权。'
            : 'Keep the tone calm, concrete, and non-diagnostic. Abstain when data is insufficient.',
        actionLabelHint:
          locale === 'zh-CN'
            ? 'lowRiskAction 的 label 应尽量贴近"查看报告"。'
            : 'The lowRiskAction label should stay close to "View report".',
        factsLabel: locale === 'zh-CN' ? '事实 JSON：' : 'Facts JSON:',
      })),
      buildFallback: vi.fn((context: typeof baseAiContext, locale: string) => {
        const dayCount = context.coverage.medication.totalDays;
        const allInsufficient =
          context.coverage.medication.trackedDays === 0 &&
          context.coverage.water.trackedDays === 0 &&
          context.coverage.sleep.trackedDays === 0;
        const disclaimer =
          locale === 'zh-CN'
            ? `仅基于近 ${dayCount} 天已记录数据，不构成诊断或治疗建议。`
            : `Generated only from the last ${dayCount} days of recorded data. This is not a diagnosis or treatment advice.`;
        if (allInsufficient) {
          return {
            summary:
              locale === 'zh-CN'
                ? `近 ${dayCount} 天三项指标均无足够记录数据，暂不生成洞察总结。`
                : `Insufficient data across all three dimensions in the last ${dayCount} days. No insight is generated.`,
            coverage: context.coverage,
            observedPattern: null,
            lowRiskAction: null,
            disclaimer,
          };
        }
        const med = context.metrics.find((m) => m.kind === 'medication');
        return {
          summary:
            locale === 'zh-CN'
              ? `近 ${dayCount} 天记录已更新。`
              : `The last ${dayCount} days of records were updated.`,
          coverage: context.coverage,
          observedPattern: med
            ? {
                kind: 'medication' as const,
                text: `近 ${context.coverage.medication.trackedDays} 天用药完成率约为 ${med.value}%。`,
                source: 'reminder_plan',
              }
            : null,
          lowRiskAction: {
            label: locale === 'zh-CN' ? '查看报告' : 'View report',
            text:
              locale === 'zh-CN'
                ? '建议继续记录日常饮水量。'
                : 'Keep logging daily water intake.',
          },
          disclaimer,
        };
      }),
    } as unknown as ReportsLlmSummaryCopyService;
    const reportsAiSummaryGeneratorService = {
      hasAnalysisModel: vi
        .fn()
        .mockReturnValue(
          (options?.config ?? baseConfig).analysis.model != null,
        ),
      generate: vi.fn(),
    } as unknown as ReportsAiSummaryGeneratorService;
    return new ReportsAiSummaryService(
      prisma as never,
      aiSummaryHistoryService as never,
      reportsContextService,
      reportsComputationService,
      reportsAiSummaryContextService,
      reportsLlmSummaryCopyService,
      reportsAiSummaryGeneratorService,
      new LlmSafetyPolicyService({
        safety: { forbiddenPatterns: [] },
      } as never),
    );
  }
});
