import { ForbiddenException } from '@nestjs/common';
import type { AiConfig } from '../../../config/ai.config';
import type { TodayAnalysisCopyService } from './copy.service';
import type { TodayAnalysisContextService } from './context.service';
import type { TodayAnalysisGeneratorService } from './generator.service';
import { AiSafetyPolicyService } from '../../../common/ai/ai-safety-policy.service';
import { TodayAnalysisService } from './analysis.service';
import type { NotificationsService } from '../../notifications/services/notifications.service';

function modelGenerateSpy(service: TodayAnalysisService) {
  return jest.spyOn(
    (
      service as unknown as {
        generatorService: { generate: jest.Mock };
      }
    ).generatorService,
    'generate',
  );
}

describe('TodayAnalysisService', () => {
  const baseConfig: AiConfig = {
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

  const baseContext = {
    date: '2026-06-12',
    water: {
      completedCount: 4,
      targetCount: 8,
      remainingCount: 4,
    },
    medication: {
      medicineCount: 2,
      pendingCount: 1,
      nextDoseTimeLabel: '20:00',
      nextMedicineName: '维生素B族',
      currentMedicineNames: ['维生素B族', '阿托伐他汀'],
    },
    recordSummary: [{ kind: 'water', count: 4 }],
    recentRecords: [],
    sleep: {
      status: 'insufficient_data' as const,
    },
    lowRiskContext: {
      activeAllergyCount: 0,
      currentMedicineCount: 2,
    },
  };

  it('returns model output when policy accepts it', async () => {
    const service = createService();
    const modelOutput = {
      summary: '今日记录主要集中在饮水和用药，仍有一项待确认。',
      bullets: [
        {
          kind: 'medication' as const,
          text: '还有 1 项今日用药待确认，先核对是否已经服用。',
        },
        {
          kind: 'hydration' as const,
          text: '今日饮水仍未达目标，建议下午和晚间各补 1 次。',
        },
      ],
      actionLabel: '查看今日记录',
      action: 'today',
      confidenceNote: '仅基于今日已记录数据生成，不构成诊断或治疗建议。',
    };

    modelGenerateSpy(service).mockResolvedValue(modelOutput);

    const result = await service.generate(
      'u1',
      { date: '2026-06-12' },
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
          text: '多喝水。',
        },
      ],
      actionLabel: '查看今日记录',
      action: 'today',
      confidenceNote: '仅供参考。',
    });

    const result = await service.generate(
      'u1',
      { date: '2026-06-12' },
      'zh-CN',
    );

    expect(result.summary).toContain('饮水');
    expect(result.bullets[2]?.kind).toBe('sleep');
  });

  it('falls back when the model invocation throws', async () => {
    const service = createService();
    modelGenerateSpy(service).mockRejectedValue(new Error('model failed'));

    const result = await service.generate(
      'u1',
      { date: '2026-06-12' },
      'zh-CN',
    );

    expect(result.actionLabel).toBe('查看今日记录');
    expect(result.confidenceNote).toBe(
      '仅基于今日已记录数据生成，不构成诊断或治疗建议。',
    );
  });

  it('falls back in English when requested language is English', async () => {
    const service = createService();
    modelGenerateSpy(service).mockRejectedValue(new Error('model failed'));

    const result = await service.generate(
      'u1',
      { date: '2026-06-12' },
      'en-US',
    );

    expect(result.actionLabel).toBe('View today');
    expect(result.confidenceNote).toBe(
      "Generated only from today's recorded data. This is not a diagnosis or treatment advice.",
    );
    expect(result.bullets[2]?.text).toContain('sleep data');
  });

  it('streams fallback summary when analysis model config is missing', async () => {
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
    const summaries: string[] = [];

    const result = await service.generateStream(
      'u1',
      { date: '2026-06-12' },
      'zh-CN',
      ({ summary }) => {
        summaries.push(summary);
      },
    );

    expect(summaries).toEqual([result.summary]);
  });

  it('streams final summary when the model emits no partial summary', async () => {
    const service = createService();
    const summaries: string[] = [];
    const generatorService = (
      service as unknown as {
        generatorService: {
          generateStream: jest.Mock;
        };
      }
    ).generatorService;

    generatorService.generateStream.mockResolvedValue({
      summary: '今日记录整体稳定，晚些时候继续补水即可。',
      bullets: [
        {
          kind: 'medication',
          text: '今日用药记录基本完整。',
        },
        {
          kind: 'hydration',
          text: '饮水还可以再补 1 到 2 次。',
        },
      ],
      actionLabel: '查看今日记录',
      confidenceNote: '仅基于今日已记录数据生成，不构成诊断或治疗建议。',
    });

    const result = await service.generateStream(
      'u1',
      { date: '2026-06-12' },
      'zh-CN',
      ({ summary }) => {
        summaries.push(summary);
      },
    );

    expect(summaries).toEqual([result.summary]);
  });

  it('rejects when ai summaries are disabled by user setting', async () => {
    const service = createService({
      userSettingValue: false,
    });

    await expect(
      service.generate('u1', { date: '2026-06-12' }, 'zh-CN'),
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
      { date: '2026-06-12' },
      'zh-CN',
    );

    expect(result.summary).toContain('今日');
    expect(result.actionLabel).toBe('查看今日记录');
  });

  function createService(options?: {
    userSettingValue?: boolean;
    config?: AiConfig;
  }) {
    const prisma = {
      userSetting: {
        findFirst: jest.fn().mockResolvedValue({
          value: options?.userSettingValue ?? true,
        }),
      },
    };

    const contextService = {
      build: jest.fn().mockResolvedValue(baseContext),
    } as unknown as TodayAnalysisContextService;
    const aiSummaryHistoryService = {
      save: jest.fn().mockResolvedValue(undefined),
    };

    const copyService = {
      resolveLocale: jest.fn((language: string | undefined) => {
        const normalized = language?.trim().toLowerCase() ?? '';
        return normalized.startsWith('zh') ? 'zh-CN' : 'en';
      }),
      serviceUnavailable: jest.fn((locale: string) =>
        locale === 'zh-CN'
          ? '今日 AI 分析服务尚未配置'
          : 'Today AI analysis is not configured',
      ),
      summariesDisabled: jest.fn((locale: string) =>
        locale === 'zh-CN'
          ? '该用户已关闭 AI 总结'
          : 'AI summaries are disabled for this user',
      ),
      buildPromptCopy: jest.fn((locale: string) => ({
        userIntro:
          locale === 'zh-CN'
            ? '请基于提供的 JSON 事实生成一段简短的中文总结。'
            : 'Generate a brief English summary for the supplied JSON facts.',
        tone:
          locale === 'zh-CN'
            ? '语气保持平静、具体，不要做诊断。'
            : 'Keep the tone calm, concrete, and non-diagnostic.',
        actionLabelHint:
          locale === 'zh-CN'
            ? 'actionLabel 应尽量贴近“查看今日记录”。'
            : 'The actionLabel should stay close to "View today".',
        factsLabel: locale === 'zh-CN' ? '事实 JSON：' : 'Facts JSON:',
      })),
      buildFallback: jest.fn((context: typeof baseContext, locale: string) => {
        const medicationPending = context.medication.pendingCount;
        const waterRemaining = context.water.remainingCount;

        if (locale === 'zh-CN') {
          return {
            summary:
              medicationPending > 0 && waterRemaining > 0
                ? `今日还有 ${String(medicationPending)} 项用药待确认，饮水也还差 ${String(waterRemaining)} 次。`
                : '今日饮水记录还没达标，还差 4 次可以补齐。',
            bullets: [
              {
                kind: 'medication' as const,
                text: `还有 ${String(medicationPending)} 项今日用药待确认，先核对是否已经服用。`,
              },
              {
                kind: 'hydration' as const,
                text: `今日饮水仍未达目标，建议再补 ${String(waterRemaining)} 次记录。`,
              },
              {
                kind: 'sleep' as const,
                text: '今天还没有真实睡眠数据，今晚记录后总结会更完整。',
              },
            ],
            actionLabel: '查看今日记录',
            confidenceNote: '仅基于今日已记录数据生成，不构成诊断或治疗建议。',
          };
        }

        return {
          summary:
            medicationPending > 0 && waterRemaining > 0
              ? `${String(medicationPending)} medication items still need confirmation, and ${String(waterRemaining)} water check-ins are still missing today.`
              : "Today's water records have not reached the goal yet. 4 more check-ins can complete it.",
          bullets: [
            {
              kind: 'medication' as const,
              text: `${String(medicationPending)} medication items still need confirmation today. Check first whether they were already taken.`,
            },
            {
              kind: 'hydration' as const,
              text: `Today's water records are still below the goal. Add ${String(waterRemaining)} more check-ins when possible.`,
            },
            {
              kind: 'sleep' as const,
              text: 'There is no real sleep data yet today. Logging tonight will make the summary more complete.',
            },
          ],
          actionLabel: 'View today',
          confidenceNote:
            "Generated only from today's recorded data. This is not a diagnosis or treatment advice.",
        };
      }),
    } as unknown as TodayAnalysisCopyService;
    const generatorService = {
      hasAnalysisModel: jest
        .fn()
        .mockReturnValue(
          (options?.config ?? baseConfig).analysis.model != null,
        ),
      generate: jest.fn(),
      generateStream: jest.fn(),
    } as unknown as TodayAnalysisGeneratorService;

    const notificationsService = {
      create: jest.fn(),
    } as unknown as NotificationsService;
    return new TodayAnalysisService(
      prisma as never,
      aiSummaryHistoryService as never,
      contextService,
      copyService,
      generatorService,
      new AiSafetyPolicyService({ safety: { forbiddenPatterns: [] } } as never),
      notificationsService,
    );
  }
});
