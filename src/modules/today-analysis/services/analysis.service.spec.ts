import { DomainFailureException } from '../../../common/result/domain-failure.exception.js';
import type { LlmConfig } from '../../../config/services/llm.config.js';
import type { TodayAnalysisCopyService } from './pipeline/copy.service.js';
import type {
  TodayAnalysisContext,
  TodayAnalysisContextService,
} from './pipeline/context.service.js';
import type { NotificationsService } from '../../notifications/index.js';
import type { TodayAnalysisGeneratorService } from './pipeline/generator.service.js';
import { LlmSafetyPolicyService } from '../../../common/llm/safety/llm-safety-policy.service.js';
import { TodayAnalysisService } from './analysis.service.js';
import { fromPromise, okAsync } from '../../../common/result/index.js';
import type { PushDeliveryService } from '../../notifications/index.js';

function modelGenerateSpy(service: TodayAnalysisService) {
  return vi.spyOn(
    (
      service as unknown as {
        generatorService: { generate: vi.Mock };
      }
    ).generatorService,
    'generate',
  );
}

function modelGenerateStreamSpy(service: TodayAnalysisService) {
  return vi.spyOn(
    (
      service as unknown as {
        generatorService: { generateStream: vi.Mock };
      }
    ).generatorService,
    'generateStream',
  );
}

function notificationCreateOrReplaceScopedSpy(service: TodayAnalysisService) {
  return vi.spyOn(
    (
      service as unknown as {
        notificationsService: { createOrReplaceScoped: vi.Mock };
      }
    ).notificationsService,
    'createOrReplaceScoped',
  );
}

function pushDeliverySendToUserSpy(service: TodayAnalysisService) {
  return vi.spyOn(
    (
      service as unknown as {
        pushDeliveryService: { sendToUser: vi.Mock };
      }
    ).pushDeliveryService,
    'sendToUser',
  );
}

describe('TodayAnalysisService', () => {
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

  const emptyContext: TodayAnalysisContext = {
    date: '2026-06-12',
    water: {
      completedCount: 0,
      targetCount: 8,
      remainingCount: 0,
    },
    medication: {
      medicineCount: 0,
      pendingCount: 0,
      nextDoseTimeLabel: '--',
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
  };

  it('returns model output when policy accepts it', async () => {
    const service = createService();
    const notifySpy = notificationCreateOrReplaceScopedSpy(service);
    const pushSpy = pushDeliverySendToUserSpy(service);
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
      confidenceNote: '仅基于今日已记录数据生成，仅供参考。',
    };

    modelGenerateSpy(service).mockResolvedValue(modelOutput);

    const result = await service.generate(
      'u1',
      { date: '2026-06-12' },
      'zh-CN',
    );

    expect(result.summary).toBe(modelOutput.summary);
    expect(result.bullets).toEqual(modelOutput.bullets);
    expect(result.aiGenerated).toBe(true);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith(
      'u1',
      {
        type: 'ai_today_summary',
        title: 'AI 今日总结已生成',
        content: modelOutput.summary,
        action: 'today',
        actionPayload: {
          date: '2026-06-12',
          source: 'today-analysis',
        },
      },
      {
        date: '2026-06-12',
        source: 'today-analysis',
      },
    );
    expect(pushSpy).toHaveBeenCalledWith('u1', {
      title: 'AI 今日总结已生成',
      body: modelOutput.summary,
    });
  });

  it('marks aiGenerated as false when using fallback', async () => {
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
    const notifySpy = notificationCreateOrReplaceScopedSpy(service);

    const result = await service.generate(
      'u1',
      { date: '2026-06-12' },
      'zh-CN',
    );

    expect(result.aiGenerated).toBe(false);
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it('returns empty status and does not persist or notify when context is empty', async () => {
    const service = createService({
      context: emptyContext,
      materializationStatus: {
        status: 'empty',
        sourceVersion: 0,
        computedVersion: 0,
        computedAt: null,
      },
    });
    const modelSpy = modelGenerateSpy(service);
    const notifySpy = notificationCreateOrReplaceScopedSpy(service);
    const pushSpy = pushDeliverySendToUserSpy(service);
    const aiSummaryHistoryService = (
      service as unknown as {
        aiSummaryHistoryService: { save: vi.Mock };
      }
    ).aiSummaryHistoryService;

    const result = await service.generateForVersion(
      'u1',
      { date: '2026-06-12' },
      'zh-CN',
      1,
    );

    expect('status' in result).toBe(true);
    expect(result).toMatchObject({ status: 'empty' });
    expect(modelSpy).not.toHaveBeenCalled();
    expect(notifySpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(aiSummaryHistoryService.save).not.toHaveBeenCalled();
  });

  it('readCurrent includes aiGenerated from persisted summary', async () => {
    const service = createService({
      materializationStatus: {
        status: 'ready',
        sourceVersion: 2,
        computedVersion: 2,
        computedAt: new Date('2026-08-10T08:00:00.000Z'),
      },
      summary: { sourceVersion: 2 },
    });
    (
      service as unknown as {
        aiSummaryHistoryService: { getLatestTodaySummaryByDate: vi.Mock };
      }
    ).aiSummaryHistoryService.getLatestTodaySummaryByDate.mockResolvedValue({
      date: '2026-08-10',
      generatedAt: '2026-08-10T08:00:00.000Z',
      summary: '旧摘要',
      bullets: [],
      actionLabel: '查看今日记录',
      action: 'today',
      confidenceNote: '仅供参考。',
      aiGenerated: true,
      sourceVersion: 2,
    });

    const result = await service.readCurrent('u1', '2026-08-10');

    expect(result.analysis?.aiGenerated).toBe(true);
  });

  it('characterizes explicit generate as the current model execution entrypoint', async () => {
    const service = createService();
    const modelSpy = modelGenerateSpy(service).mockResolvedValue({
      summary: '今日记录良好。',
      bullets: [
        { kind: 'medication', text: '用药记录完整。' },
        { kind: 'hydration', text: '饮水记录完整。' },
      ],
      actionLabel: '查看今日记录',
      action: 'today',
      confidenceNote: '仅供参考。',
    });

    await service.generate('u1', { date: '2026-06-12' }, 'zh-CN');

    expect(modelSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the claimed active fence when committing a versioned generation', async () => {
    const service = createService({
      materializationStatus: {
        status: 'pending',
        sourceVersion: 4,
        computedVersion: 3,
        computedAt: null,
      },
      claimActiveVersion: 5,
    });
    modelGenerateSpy(service).mockResolvedValue(versionedOutput);

    await service.generateForVersion('u1', { date: '2026-06-12' }, 'zh-CN', 4);

    expect(materializationWriteSpies(service).markReady).toHaveBeenCalledWith(
      expect.objectContaining({ sourceVersion: 4, activeVersion: 5 }),
    );
  });

  it('rejects a claimed generation without an active fence', async () => {
    const service = createService({
      materializationStatus: {
        status: 'pending',
        sourceVersion: 4,
        computedVersion: 3,
        computedAt: null,
      },
      claimActiveVersion: null,
    });

    await expect(
      service.generateForVersion('u1', { date: '2026-06-12' }, 'zh-CN', 4),
    ).rejects.toThrow('TODAY_ANALYSIS_CLAIM_FENCE_MISSING');
  });

  it('uses the claimed active fence when recording a failed versioned generation', async () => {
    const service = createService({
      materializationStatus: {
        status: 'pending',
        sourceVersion: 4,
        computedVersion: 3,
        computedAt: null,
      },
      claimActiveVersion: 5,
    });
    modelGenerateSpy(service).mockResolvedValue(versionedOutput);
    (
      service as unknown as { aiSummaryHistoryService: { save: vi.Mock } }
    ).aiSummaryHistoryService.save.mockReturnValue(
      fromPromise(Promise.reject(new Error('persist failed')), (error) => {
        throw error;
      }),
    );

    await expect(
      service.generateForVersion('u1', { date: '2026-06-12' }, 'zh-CN', 4),
    ).rejects.toThrow('persist failed');

    expect(materializationWriteSpies(service).markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ sourceVersion: 4, activeVersion: 5 }),
    );
  });

  it('uses the claimed active fence when committing a streamed versioned generation', async () => {
    const service = createService({
      materializationStatus: {
        status: 'pending',
        sourceVersion: 4,
        computedVersion: 3,
        computedAt: null,
      },
      claimActiveVersion: 5,
    });
    modelGenerateStreamSpy(service).mockResolvedValue(versionedOutput);

    await service.generateStreamForVersion(
      'u1',
      { date: '2026-06-12' },
      'zh-CN',
      4,
      () => undefined,
    );

    expect(materializationWriteSpies(service).markReady).toHaveBeenCalledWith(
      expect.objectContaining({ sourceVersion: 4, activeVersion: 5 }),
    );
  });

  it('uses the claimed active fence when recording a failed streamed generation', async () => {
    const service = createService({
      materializationStatus: {
        status: 'pending',
        sourceVersion: 4,
        computedVersion: 3,
        computedAt: null,
      },
      claimActiveVersion: 5,
    });
    modelGenerateStreamSpy(service).mockResolvedValue(versionedOutput);
    (
      service as unknown as { aiSummaryHistoryService: { save: vi.Mock } }
    ).aiSummaryHistoryService.save.mockReturnValue(
      fromPromise(Promise.reject(new Error('persist failed')), (error) => {
        throw error;
      }),
    );

    await expect(
      service.generateStreamForVersion(
        'u1',
        { date: '2026-06-12' },
        'zh-CN',
        4,
        () => undefined,
      ),
    ).rejects.toThrow('persist failed');

    expect(materializationWriteSpies(service).markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ sourceVersion: 4, activeVersion: 5 }),
    );
  });

  it('preserves the original generation error when failed cleanup throws', async () => {
    const service = createService({
      materializationStatus: {
        status: 'pending',
        sourceVersion: 4,
        computedVersion: 3,
        computedAt: null,
      },
      claimActiveVersion: 5,
    });
    const originalError = new Error('original generation error');
    const cleanupError = new Error('cleanup error');
    const loggerError = vi.spyOn(
      (service as unknown as { logger: { error: vi.Mock } }).logger,
      'error',
    );
    (
      service as unknown as { aiSummaryHistoryService: { save: vi.Mock } }
    ).aiSummaryHistoryService.save.mockReturnValue(
      fromPromise(Promise.reject(originalError), (error) => {
        throw error;
      }),
    );
    materializationWriteSpies(service).markFailed.mockRejectedValue(
      cleanupError,
    );

    await expect(
      service.generateForVersion('u1', { date: '2026-06-12' }, 'zh-CN', 4),
    ).rejects.toBe(originalError);
    expect(loggerError).toHaveBeenCalled();
  });

  it('preserves the original streamed generation error when failed cleanup throws', async () => {
    const service = createService({
      materializationStatus: {
        status: 'pending',
        sourceVersion: 4,
        computedVersion: 3,
        computedAt: null,
      },
      claimActiveVersion: 5,
    });
    const originalError = new Error('original streamed generation error');
    const cleanupError = new Error('cleanup error');
    const loggerError = vi.spyOn(
      (service as unknown as { logger: { error: vi.Mock } }).logger,
      'error',
    );
    (
      service as unknown as { aiSummaryHistoryService: { save: vi.Mock } }
    ).aiSummaryHistoryService.save.mockReturnValue(
      fromPromise(Promise.reject(originalError), (error) => {
        throw error;
      }),
    );
    materializationWriteSpies(service).markFailed.mockRejectedValue(
      cleanupError,
    );

    await expect(
      service.generateStreamForVersion(
        'u1',
        { date: '2026-06-12' },
        'zh-CN',
        4,
        () => undefined,
      ),
    ).rejects.toBe(originalError);
    expect(loggerError).toHaveBeenCalled();
  });

  it('red: readCurrent returns existing analysis without invoking generation', async () => {
    const service = createService();
    const modelSpy = modelGenerateSpy(service);
    const readCurrent = (
      service as unknown as {
        readCurrent?: (
          userId: string,
          date: string,
          locale: string,
        ) => Promise<unknown>;
      }
    ).readCurrent;

    // Planned API: reads materialized analysis and never starts the LLM path.
    expect(readCurrent).toBeTypeOf('function');
    if (readCurrent == null) return;

    await readCurrent.call(service, 'u1', '2026-06-12', 'zh-CN');

    expect(modelSpy).not.toHaveBeenCalled();
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
          generateStream: vi.Mock;
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
      { date: '2026-06-12' },
      'zh-CN',
    );

    expect(result.summary).toContain('今日');
    expect(result.actionLabel).toBe('查看今日记录');
  });

  it('uses the default profile timezone when dto.date is omitted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T16:30:00.000Z'));
    const service = createService();
    // Override the context mock to echo the date passed to build()
    (
      service as unknown as {
        contextService: { build: vi.Mock };
      }
    ).contextService.build.mockImplementation(
      (_userId: string, date: string) => ({
        ...baseContext,
        date,
      }),
    );
    modelGenerateSpy(service).mockResolvedValue({
      summary: '今日记录良好。',
      bullets: [
        { kind: 'medication', text: '用药全部完成。' },
        { kind: 'hydration', text: '饮水已达标。' },
      ],
      actionLabel: '查看今日记录',
      action: 'today',
      confidenceNote: '仅供参考。',
    });

    const result = await service.generate('u1', {}, 'zh-CN');

    expect(result.date).toBe('2026-08-02');
    vi.useRealTimers();
  });

  it('uses the profile timezone when no date is supplied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T23:30:00.000Z'));
    const service = createService({ timezone: 'America/Los_Angeles' });
    (
      service as unknown as {
        contextService: { build: vi.Mock };
      }
    ).contextService.build.mockImplementation(
      (_userId: string, date: string) => ({
        ...baseContext,
        date,
      }),
    );
    modelGenerateSpy(service).mockResolvedValue({
      summary: '今日记录良好。',
      bullets: [
        { kind: 'medication', text: '用药全部完成。' },
        { kind: 'hydration', text: '饮水已达标。' },
      ],
      actionLabel: '查看今日记录',
      action: 'today',
      confidenceNote: '仅供参考。',
    });

    const result = await service.generate('u1', {}, 'zh-CN');

    expect(result.date).toBe('2026-08-01');
    vi.useRealTimers();
  });

  it('does not expose a summary before its materialization is ready', async () => {
    const service = createService({
      materializationStatus: {
        status: 'pending',
        sourceVersion: 2,
        computedVersion: 1,
        computedAt: new Date('2026-08-10T08:00:00.000Z'),
      },
      summary: { sourceVersion: 2 },
    });

    await expect(
      service.readCurrent('u1', '2026-08-10'),
    ).resolves.toMatchObject({
      analysis: null,
      status: 'stale',
      sourceVersion: 2,
      computedVersion: 1,
    });
  });

  it('does not expose a failed generation when there is no computed version', async () => {
    const service = createService({
      materializationStatus: {
        status: 'failed',
        sourceVersion: 1,
        computedVersion: 0,
        computedAt: null,
      },
      summary: { sourceVersion: 1 },
    });

    await expect(
      service.readCurrent('u1', '2026-08-10'),
    ).resolves.toMatchObject({
      analysis: null,
      status: 'failed',
      sourceVersion: 1,
      computedVersion: 0,
    });
  });

  it('swallows notification failure without breaking generation', async () => {
    const service = createService();
    modelGenerateSpy(service).mockResolvedValue({
      summary: '今日记录良好。',
      bullets: [
        { kind: 'medication', text: '用药全部完成。' },
        { kind: 'hydration', text: '饮水已达标。' },
      ],
      actionLabel: '查看今日记录',
      action: 'today',
      confidenceNote: '仅供参考。',
    });

    // Make notificationsService.createOrReplaceScoped throw on every call
    const notifySpy = notificationCreateOrReplaceScopedSpy(service);
    notifySpy.mockRejectedValue(new Error('notification service down'));

    // Should not throw
    const result = await service.generate(
      'u1',
      { date: '2026-06-12' },
      'zh-CN',
    );

    expect(result.summary).toBe('今日记录良好。');
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it('includes confidenceNote and aiGenerated in the persisted data', async () => {
    const service = createService();
    const aiSummaryHistoryService = (
      service as unknown as {
        aiSummaryHistoryService: { save: vi.Mock };
      }
    ).aiSummaryHistoryService;

    modelGenerateSpy(service).mockResolvedValue({
      summary: '今日状态良好。',
      bullets: [
        { kind: 'medication', text: '用药完成。' },
        { kind: 'hydration', text: '饮水达标。' },
      ],
      actionLabel: '查看今日记录',
      action: 'today',
      confidenceNote: '高置信度。',
    });

    await service.generate('u1', { date: '2026-06-12' }, 'zh-CN');

    expect(aiSummaryHistoryService.save).toHaveBeenCalledWith(
      expect.objectContaining({
        confidenceNote: '高置信度。',
        aiGenerated: true,
      }),
    );
  });

  function createService(options?: {
    userSettingValue?: boolean;
    config?: LlmConfig;
    timezone?: string | null;
    materializationStatus?: {
      status: 'empty' | 'pending' | 'ready' | 'stale' | 'failed';
      sourceVersion: number;
      computedVersion: number;
      computedAt: Date | null;
    };
    summary?: { sourceVersion: number | null };
    claimActiveVersion?: number | null;
    context?: TodayAnalysisContext;
  }) {
    const prisma = {
      userSetting: {
        findFirst: vi.fn().mockResolvedValue({
          value: options?.userSettingValue ?? true,
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          profile: { timezone: options?.timezone ?? null },
        }),
      },
    };

    const contextService = {
      build: vi.fn().mockResolvedValue(options?.context ?? baseContext),
    } as unknown as TodayAnalysisContextService;
    const aiSummaryHistoryService = {
      save: vi.fn().mockReturnValue(okAsync(undefined)),
      getLatestTodaySummaryByDate: vi.fn().mockResolvedValue(
        options?.summary == null
          ? null
          : {
              date: '2026-08-10',
              generatedAt: '2026-08-10T08:00:00.000Z',
              summary: '旧摘要',
              bullets: [],
              actionLabel: '查看今日记录',
              action: 'today',
              confidenceNote: '仅供参考。',
              aiGenerated: false,
              sourceVersion: options.summary.sourceVersion,
            },
      ),
    };

    const materializationStore =
      options?.materializationStatus == null
        ? undefined
        : {
            readStatus: vi.fn().mockResolvedValue({
              id: 'materialization-1',
              userId: 'u1',
              localDate: new Date('2026-08-10T00:00:00.000Z'),
              reasonCodes: [],
              generationCount: 1,
              activeVersion: null,
              activeAt: null,
              lastManualAt: null,
              lastTriggerKey: null,
              lastErrorCode: null,
              queuedAt: null,
              updatedAt: new Date('2026-08-10T08:00:00.000Z'),
              ...options.materializationStatus,
              status:
                options.materializationStatus.status === 'pending' &&
                options.materializationStatus.sourceVersion >
                  options.materializationStatus.computedVersion &&
                options.materializationStatus.computedVersion > 0
                  ? 'stale'
                  : options.materializationStatus.status,
            }),
            claimGeneration: vi.fn().mockResolvedValue({
              claimed: true,
              status: 'claimed',
              activeVersion:
                options.claimActiveVersion === undefined
                  ? 4
                  : options.claimActiveVersion,
            }),
            markReady: vi.fn().mockResolvedValue(true),
            markFailed: vi.fn().mockResolvedValue(true),
          };

    const copyService = {
      resolveLocale: vi.fn((language: string | undefined) => {
        const normalized = language?.trim().toLowerCase() ?? '';
        return normalized.startsWith('zh') ? 'zh-CN' : 'en';
      }),
      serviceUnavailable: vi.fn((locale: string) =>
        locale === 'zh-CN'
          ? '今日 AI 分析服务尚未配置'
          : 'Today AI analysis is not configured',
      ),
      summariesDisabled: vi.fn((locale: string) =>
        locale === 'zh-CN'
          ? '该用户已关闭 AI 总结'
          : 'AI summaries are disabled for this user',
      ),
      buildPromptCopy: vi.fn((locale: string) => ({
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
      buildFallback: vi.fn((context: typeof baseContext, locale: string) => {
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
      hasAnalysisModel: vi
        .fn()
        .mockReturnValue(
          (options?.config ?? baseConfig).analysis.model != null,
        ),
      generate: vi.fn(),
      generateStream: vi.fn(),
    } as unknown as TodayAnalysisGeneratorService;

    const notificationsService = {
      create: vi.fn(),
      createOrReplaceScoped: vi.fn().mockReturnValue(okAsync(undefined)),
    } as unknown as NotificationsService;
    const pushDeliveryService = {
      sendToUser: vi.fn().mockResolvedValue({ sent: true }),
    } as unknown as PushDeliveryService;
    return new TodayAnalysisService(
      prisma as never,
      aiSummaryHistoryService as never,
      contextService,
      copyService,
      generatorService,
      new LlmSafetyPolicyService({
        safety: { forbiddenPatterns: [] },
      } as never),
      notificationsService,
      pushDeliveryService,
      materializationStore as never,
    );
  }

  function materializationWriteSpies(service: TodayAnalysisService) {
    return (
      service as unknown as {
        materializationStore: {
          markReady: vi.Mock;
          markFailed: vi.Mock;
        };
      }
    ).materializationStore;
  }
});

const versionedOutput = {
  summary: '今日记录良好。',
  bullets: [
    { kind: 'medication' as const, text: '用药记录完整。' },
    { kind: 'hydration' as const, text: '饮水记录完整。' },
  ],
  actionLabel: '查看今日记录',
  action: 'today',
  confidenceNote: '仅供参考。',
};
