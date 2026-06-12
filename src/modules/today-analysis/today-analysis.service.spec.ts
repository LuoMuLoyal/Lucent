import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { I18nService } from 'nestjs-i18n';
import type { AiConfig } from '../../config/ai.config';
import type { LlmRuntimeService } from '../llm-runtime/llm-runtime.service';
import type { TodayAnalysisContextService } from './today-analysis-context.service';
import { TodayAnalysisPolicyService } from './today-analysis-policy.service';
import { TodayAnalysisService } from './today-analysis.service';

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
      confidenceNote: '仅基于今日已记录数据生成，不构成诊断或治疗建议。',
    };

    jest
      .spyOn(service as never, 'invokeModel')
      .mockResolvedValue(modelOutput as never);

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
    jest.spyOn(service as never, 'invokeModel').mockResolvedValue({
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
      confidenceNote: '仅供参考。',
    } as never);

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
    jest
      .spyOn(service as never, 'invokeModel')
      .mockRejectedValue(new Error('model failed'));

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
    jest
      .spyOn(service as never, 'invokeModel')
      .mockRejectedValue(new Error('model failed'));

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

  it('rejects when ai summaries are disabled by user setting', async () => {
    const service = createService({
      userSettingValue: false,
    });

    await expect(
      service.generate('u1', { date: '2026-06-12' }, 'zh-CN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when analysis model config is missing', async () => {
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

    await expect(
      service.generate('u1', { date: '2026-06-12' }, 'zh-CN'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
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

    const policyService = new TodayAnalysisPolicyService();
    const llmRuntimeService = {
      hasRoleConfig: jest
        .fn()
        .mockReturnValue(
          (options?.config ?? baseConfig).analysis.model != null,
        ),
      createChatModel: jest.fn(),
    } as unknown as LlmRuntimeService;
    const i18n = {
      t: jest.fn(
        (
          key: string,
          options?: { lang?: string; args?: Record<string, number | string> },
        ) => {
          const lang = options?.lang ?? 'en';
          const args = options?.args ?? {};

          if (lang === 'zh-CN') {
            return zhText(key, args);
          }
          return enText(key, args);
        },
      ),
    } as unknown as I18nService;

    return new TodayAnalysisService(
      prisma as never,
      contextService,
      policyService,
      llmRuntimeService,
      i18n,
    );
  }
});

function zhText(key: string, args: Record<string, number | string>): string {
  switch (key) {
    case 'today-analysis.service_unavailable':
      return '今日 AI 分析服务尚未配置';
    case 'today-analysis.summaries_disabled':
      return '该用户已关闭 AI 总结';
    case 'today-analysis.fallback.action_label':
      return '查看今日记录';
    case 'today-analysis.fallback.confidence_note':
      return '仅基于今日已记录数据生成，不构成诊断或治疗建议。';
    case 'today-analysis.fallback.summary_default':
      return '今日记录已更新，可先根据已记录事项继续补全今天的数据。';
    case 'today-analysis.fallback.summary_medication_and_hydration':
      return `今日还有 ${String(args['medicationPending'])} 项用药待确认，饮水也还差 ${String(args['waterRemaining'])} 次。`;
    case 'today-analysis.fallback.summary_medication_only':
      return `今日记录主要集中在用药，还有 ${String(args['medicationPending'])} 项待确认。`;
    case 'today-analysis.fallback.summary_hydration_only':
      return `今日饮水记录还没达标，还差 ${String(args['waterRemaining'])} 次可以补齐。`;
    case 'today-analysis.fallback.bullet_medication_pending':
      return `还有 ${String(args['medicationPending'])} 项今日用药待确认，先核对是否已经服用。`;
    case 'today-analysis.fallback.bullet_medication_done':
      return '今日已记录的用药状态较完整，继续保持即可。';
    case 'today-analysis.fallback.bullet_hydration_pending':
      return `今日饮水仍未达目标，建议再补 ${String(args['waterRemaining'])} 次记录。`;
    case 'today-analysis.fallback.bullet_hydration_done':
      return '今日饮水记录已达到目标，可以继续按当前节奏保持。';
    case 'today-analysis.fallback.bullet_sleep_missing':
      return '今天还没有真实睡眠数据，今晚记录后总结会更完整。';
    case 'today-analysis.prompt.user_intro':
      return '请基于提供的 JSON 事实生成一段简短的中文总结。';
    case 'today-analysis.prompt.tone':
      return '语气保持平静、具体，不要做诊断。';
    case 'today-analysis.prompt.action_label_hint':
      return 'actionLabel 应尽量贴近“查看今日记录”。';
    case 'today-analysis.prompt.facts_label':
      return '事实 JSON：';
    default:
      return key;
  }
}

function enText(key: string, args: Record<string, number | string>): string {
  switch (key) {
    case 'today-analysis.service_unavailable':
      return 'Today AI analysis is not configured';
    case 'today-analysis.summaries_disabled':
      return 'AI summaries are disabled for this user';
    case 'today-analysis.fallback.action_label':
      return 'View today';
    case 'today-analysis.fallback.confidence_note':
      return "Generated only from today's recorded data. This is not a diagnosis or treatment advice.";
    case 'today-analysis.fallback.summary_default':
      return "Today's records were updated. Continue filling in today's data based on what is already logged.";
    case 'today-analysis.fallback.summary_medication_and_hydration':
      return `${String(args['medicationPending'])} medication items still need confirmation, and ${String(args['waterRemaining'])} water check-ins are still missing today.`;
    case 'today-analysis.fallback.summary_medication_only':
      return `Today's records are mainly about medication, and ${String(args['medicationPending'])} items still need confirmation.`;
    case 'today-analysis.fallback.summary_hydration_only':
      return `Today's water records have not reached the goal yet. ${String(args['waterRemaining'])} more check-ins can complete it.`;
    case 'today-analysis.fallback.bullet_medication_pending':
      return `${String(args['medicationPending'])} medication items still need confirmation today. Check first whether they were already taken.`;
    case 'today-analysis.fallback.bullet_medication_done':
      return "Today's medication status is recorded relatively completely. Keep the current pace.";
    case 'today-analysis.fallback.bullet_hydration_pending':
      return `Today's water records are still below the goal. Add ${String(args['waterRemaining'])} more check-ins when possible.`;
    case 'today-analysis.fallback.bullet_hydration_done':
      return "Today's water records have reached the goal. You can keep the current pace.";
    case 'today-analysis.fallback.bullet_sleep_missing':
      return 'There is no real sleep data yet today. Logging tonight will make the summary more complete.';
    case 'today-analysis.prompt.user_intro':
      return 'Generate a brief English summary for the supplied JSON facts.';
    case 'today-analysis.prompt.tone':
      return 'Keep the tone calm, concrete, and non-diagnostic.';
    case 'today-analysis.prompt.action_label_hint':
      return 'The actionLabel should stay close to "View today".';
    case 'today-analysis.prompt.facts_label':
      return 'Facts JSON:';
    default:
      return key;
  }
}
