import { ForbiddenException } from '@nestjs/common';
import type { LlmConfig } from '../../../../config/services/llm.config';
import {
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
} from '../../dto/report-dashboard-query.dto';
import type { ReportsAiSummaryContextService } from './context.service';
import type { ReportsLlmSummaryCopyService } from './copy.service';
import type { ReportsAiSummaryGeneratorService } from './generator.service';
import { LlmSafetyPolicyService } from '../../../../common/llm/llm-safety-policy.service';
import { ReportsAiSummaryService } from './summary.service';
import type { ReportsComputationService } from '../../dashboard/computation.service';
import type { ReportsContextService } from '../../dashboard/context.service';

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
    score: {
      value: 78,
      maxValue: 100,
      status: 'stable' as const,
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
    dataQuality: {
      medicationTrackedDays: 6,
      waterTrackedDays: 7,
      sleepTrackedDays: 0,
      mealEstimateTrackedDays: 4,
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
      summary: '本周用药记录整体稳定，饮水连续性一般，睡眠仍缺少真实记录。',
      bullets: [
        {
          kind: 'medication' as const,
          text: '本周大多数天都有用药记录，继续保持固定节奏。',
        },
        {
          kind: 'hydration' as const,
          text: '饮水均值接近目标线，但仍有几天偏低。',
        },
        {
          kind: 'sleep' as const,
          text: '睡眠数据仍缺失，补上后周报会更完整。',
        },
      ],
      actionLabel: '查看报告',
      action: 'today',
      confidenceNote: '仅基于近 7 天已记录数据生成，不构成诊断或治疗建议。',
    };

    modelGenerateSpy(service).mockResolvedValue(modelOutput);

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'zh-CN',
    );

    expect(result.summary).toBe(modelOutput.summary);
    expect(result.bullets).toEqual(modelOutput.bullets);
  });

  it('falls back when policy rejects the model output', async () => {
    const service = createService();
    modelGenerateSpy(service).mockResolvedValue({
      summary: '建议停药并调整剂量。',
      bullets: [
        {
          kind: 'medication',
          text: '建议停药后观察。',
        },
        {
          kind: 'hydration',
          text: '可以先多喝水。',
        },
      ],
      actionLabel: '查看报告',
      action: 'today',
      confidenceNote: '仅供参考。',
    });

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'zh-CN',
    );

    expect(result.summary).toContain('本周');
    expect(result.bullets[2]?.kind).toBe('sleep');
  });

  it('falls back when the model invocation throws', async () => {
    const service = createService();
    modelGenerateSpy(service).mockRejectedValue(new Error('model failed'));

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'zh-CN',
    );

    expect(result.actionLabel).toBe('查看报告');
    expect(result.confidenceNote).toBe(
      '仅基于近 7 天已记录数据生成，不构成诊断或治疗建议。',
    );
  });

  it('falls back in English when requested language is English', async () => {
    const service = createService();
    modelGenerateSpy(service).mockRejectedValue(new Error('model failed'));

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'en-US',
    );

    expect(result.actionLabel).toBe('View report');
    expect(result.confidenceNote).toBe(
      'Generated only from the last 7 days of recorded data. This is not a diagnosis or treatment advice.',
    );
    expect(result.bullets[2]?.text).toContain('Sleep data');
  });

  it('rejects when ai summaries are disabled by user setting', async () => {
    const service = createService({
      userSettingValue: false,
    });

    await expect(
      service.generate('u1', { range: REPORT_RANGE_LAST_7_DAYS }, 'zh-CN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
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

    expect(result.summary).toContain('本周');
    expect(result.actionLabel).toBe('查看报告');
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
        series: {
          medication: Array<number>(30).fill(100),
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
    });

    modelGenerateSpy(service).mockRejectedValue(new Error('model failed'));

    const result = await service.generate(
      'u1',
      { range: REPORT_RANGE_LAST_30_DAYS },
      'zh-CN',
    );

    expect(result.range).toBe(REPORT_RANGE_LAST_30_DAYS);
    expect(result.startDate).toBe('2026-05-14');
    expect(result.confidenceNote).toContain('近 30 天');
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
      save: vi.fn().mockResolvedValue(undefined),
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
            ? '请基于提供的 JSON 事实生成一段简短的中文报告总结。'
            : 'Generate a brief English report summary for the supplied JSON facts.',
        tone:
          locale === 'zh-CN'
            ? '语气保持平静、具体，不要做诊断。'
            : 'Keep the tone calm, concrete, and non-diagnostic.',
        actionLabelHint:
          locale === 'zh-CN'
            ? 'actionLabel 应尽量贴近“查看报告”。'
            : 'The actionLabel should stay close to "View report".',
        factsLabel: locale === 'zh-CN' ? '事实 JSON：' : 'Facts JSON:',
      })),
      buildFallback: vi.fn((context: typeof baseAiContext, locale: string) => {
        const dayLabel =
          context.range === REPORT_RANGE_LAST_30_DAYS ? '30' : '7';
        if (locale === 'zh-CN') {
          return {
            summary:
              context.range === REPORT_RANGE_LAST_30_DAYS
                ? '本月记录已更新，饮水和用药可以继续按当前节奏补稳，睡眠数据仍待补充。'
                : '本周记录已更新，饮水和用药可以继续按当前节奏补稳，睡眠数据仍待补充。',
            bullets: [
              {
                kind: 'medication' as const,
                text: `近 ${dayLabel} 天里有 ${String(context.dataQuality.medicationTrackedDays)} 天有用药记录，可继续保持固定节奏。`,
              },
              {
                kind: 'hydration' as const,
                text: `近 ${dayLabel} 天饮水均值约 ${context.metrics[1]?.value ?? '--'}L，仍建议把偏低的几天补齐。`,
              },
              {
                kind: 'sleep' as const,
                text:
                  context.range === REPORT_RANGE_LAST_30_DAYS
                    ? '当前仍缺少真实睡眠数据，补上后月报会更完整。'
                    : '当前仍缺少真实睡眠数据，补上后周报会更完整。',
              },
            ],
            actionLabel: '查看报告',
            confidenceNote: `仅基于近 ${dayLabel} 天已记录数据生成，不构成诊断或治疗建议。`,
          };
        }

        return {
          summary:
            context.range === REPORT_RANGE_LAST_30_DAYS
              ? 'This month has enough records to review medication and hydration, while sleep data is still missing.'
              : 'This week has enough records to review medication and hydration, while sleep data is still missing.',
          bullets: [
            {
              kind: 'medication' as const,
              text: '${String(context.dataQuality.medicationTrackedDays)} of the last $dayLabel days contain medication records. Keep the current rhythm steady.',
            },
            {
              kind: 'hydration' as const,
              text: `Average water intake was about ${context.metrics[1]?.value ?? '--'}L across the last ${dayLabel} days, and a few lower days are still worth filling in.`,
            },
            {
              kind: 'sleep' as const,
              text:
                context.range === REPORT_RANGE_LAST_30_DAYS
                  ? 'Sleep data is still missing, so the monthly summary remains limited.'
                  : 'Sleep data is still missing, so the weekly summary remains limited.',
            },
          ],
          actionLabel: 'View report',
          confidenceNote: `Generated only from the last ${dayLabel} days of recorded data. This is not a diagnosis or treatment advice.`,
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
