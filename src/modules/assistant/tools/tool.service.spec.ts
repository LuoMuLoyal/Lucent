import { DailyRecordKind } from '#generated/prisma/client.js';
import type {
  AssistantToolCall,
  AssistantToolExecutionContext,
} from '../types/assistant.types.js';
import type { AssistantToolName } from './shared/tool-types.js';
import { TOOL_EXECUTION_TIMEOUT_MS } from './shared/tool-constants.js';
import { AssistantToolDrugbankEntityResolveService } from './drugbank/entity-resolve.service.js';
import { AssistantToolDrugbankSearchService } from './drugbank/search.service.js';
import type { AssistantToolMedicineLookupService } from './medicine/lookup.service.js';
import { AssistantToolProposalService } from './proposal/proposal.service.js';
import { AssistantDailyRecordProposalService } from './proposal/daily-record-proposal.service.js';
import { AssistantSettingsProposalService } from './proposal/settings-proposal.service.js';
import { AssistantToolReadService } from './read/read.service.js';
import { AssistantToolRecordQueryService } from './records/query.service.js';
import { AssistantToolService } from './tool.service.js';

describe('AssistantToolService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildContext(
    overrides?: Partial<AssistantToolExecutionContext>,
  ): AssistantToolExecutionContext {
    return {
      userId: 'user-1',
      locale: 'en',
      userMessage: 'show me the today summary for 2026-06-17',
      enabledContextSources: [],
      memoryEnabled: false,
      ...overrides,
    };
  }

  function toolCalls(...names: AssistantToolName[]): AssistantToolCall[] {
    return names.map((name) => ({ name, args: {} }));
  }

  function buildExecutor() {
    const aiSummaryHistoryService = {
      getLatestTodaySummaryByDate: vi.fn(),
      getLatestReportSummaryByRange: vi.fn(),
      listRecentTodaySummaries: vi.fn(),
      listRecentReportSummaries: vi.fn(),
    };
    const userHealthContextService = {
      getForUser: vi.fn(),
    };
    const medicineRemindersService = {
      list: vi.fn(),
    };
    const userSettingsService = {
      getSettings: vi.fn(),
    };
    const dailyRecordsService = {
      list: vi.fn(),
    };
    const dailyRecordReaderPort = {
      listFactsInRange: vi.fn().mockResolvedValue([]),
    };
    const dailyRecordCandidatesService = {
      generate: vi.fn(),
    };

    const recordQueryService = new AssistantToolRecordQueryService(
      dailyRecordsService as never,
      dailyRecordReaderPort as never,
    );
    const readService = new AssistantToolReadService(
      {} as never,
      aiSummaryHistoryService as never,
      userHealthContextService as never,
      medicineRemindersService as never,
      userSettingsService as never,
      recordQueryService,
    );
    const dailyRecordProposalService = new AssistantDailyRecordProposalService(
      dailyRecordCandidatesService as never,
      recordQueryService,
    );
    const settingsProposalService = new AssistantSettingsProposalService();
    const proposalService = new AssistantToolProposalService(
      dailyRecordProposalService,
      settingsProposalService,
    );
    const drugbankEntityResolveService =
      new AssistantToolDrugbankEntityResolveService({
        drugbankDrug: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as never);
    const drugbankSearchService = new AssistantToolDrugbankSearchService(
      { getStore: vi.fn() } as never,
      drugbankEntityResolveService,
    );
    const medicineLookupService: Pick<
      AssistantToolMedicineLookupService,
      'searchCnMedicineProducts' | 'getCnMedicineDetail' | 'getDrugbankDetail'
    > = {
      searchCnMedicineProducts: vi.fn().mockResolvedValue({
        query: {},
        result: { products: [] },
        coverage: { status: 'empty', reason: 'No query was provided.' },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        source: {
          tool: 'search_cn_medicine_products',
          generatedAt: new Date().toISOString(),
          tables: ['cn_medicine_products'],
        },
        confidence: { level: 'low', reason: 'Empty query.' },
        ambiguities: [],
      }),
      getCnMedicineDetail: vi.fn().mockResolvedValue({
        query: {},
        result: { product: null, candidates: [] },
        coverage: { status: 'empty', reason: 'No product query was provided.' },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        source: {
          tool: 'get_cn_medicine_detail',
          generatedAt: new Date().toISOString(),
          tables: ['cn_medicine_products'],
        },
        confidence: { level: 'low', reason: 'Empty query.' },
        ambiguities: [],
      }),
      getDrugbankDetail: vi.fn().mockResolvedValue({
        query: {},
        result: { drug: null, candidates: [] },
        coverage: {
          status: 'empty',
          reason: 'No DrugBank query was provided.',
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        source: {
          tool: 'get_drugbank_detail',
          generatedAt: new Date().toISOString(),
          tables: ['drugbank_drugs'],
        },
        confidence: { level: 'low', reason: 'Empty query.' },
        ambiguities: [],
      }),
    };
    const cache = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };
    const metricsService = {
      recordCacheAccess: vi.fn(),
    };
    const knowledgeRetrievalService = {
      searchCnMedicineKnowledge: vi.fn().mockResolvedValue({
        query: {},
        result: { chunks: [], source: 'leaflet', mode: 'naive' },
        coverage: {
          status: 'empty',
          reason: 'LightRAG retrieval is not configured.',
        },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        source: {
          tool: 'search_cn_medicine_knowledge',
          generatedAt: new Date().toISOString(),
          tables: [],
        },
        confidence: { level: 'low', reason: 'Empty query.' },
        ambiguities: [],
      }),
    };
    // OAG 工具桩：本用例只关心 dispatch 与缓存键，不跑真实的生成 + sidecar 往返。
    const ontologyReasoningService = { reasonOverOntology: vi.fn() };
    const service = new AssistantToolService(
      readService,
      knowledgeRetrievalService as never,
      drugbankEntityResolveService,
      drugbankSearchService,
      medicineLookupService as never,
      ontologyReasoningService as never,
      proposalService,
      cache as never,
      metricsService as never,
    );

    return {
      service,
      deps: {
        aiSummaryHistoryService,
        cache,
        dailyRecordCandidatesService,
        dailyRecordProposalService,
        dailyRecordReaderPort,
        dailyRecordsService,
        medicineRemindersService,
        medicineLookupService,
        knowledgeRetrievalService,
        metricsService,
        recordQueryService,
        settingsProposalService,
        userHealthContextService,
        userSettingsService,
      },
    };
  }

  it('dispatches the retrieval tools', async () => {
    const { service, deps } = buildExecutor();

    await expect(
      service.executeMany(
        buildContext(),
        toolCalls(
          'search_cn_medicine_products',
          'get_cn_medicine_detail',
          'get_drugbank_detail',
          'search_cn_medicine_knowledge',
          'resolve_drugbank_entity',
          'search_drugbank_passages',
        ),
      ),
    ).resolves.toHaveLength(6);

    expect(
      deps.medicineLookupService.searchCnMedicineProducts,
    ).toHaveBeenCalled();
    expect(deps.medicineLookupService.getCnMedicineDetail).toHaveBeenCalled();
    expect(deps.medicineLookupService.getDrugbankDetail).toHaveBeenCalled();
    expect(
      deps.knowledgeRetrievalService.searchCnMedicineKnowledge,
    ).toHaveBeenCalled();
  });

  it('forwards the model-supplied window into the meal digest read', async () => {
    const { service, deps } = buildExecutor();
    deps.dailyRecordReaderPort.listFactsInRange.mockResolvedValue([
      {
        id: 'meal-1',
        kind: DailyRecordKind.meal,
        occurredAt: new Date('2026-06-18T00:00:00.000Z'),
        occurredTime: '12:30',
        title: '午饭',
        value: null,
        unit: null,
        note: null,
        payload: null,
        mealAnalysisStatus: 'analyzed',
        mealAnalysisUpdatedAt: new Date('2026-06-18T04:40:00.000Z'),
        mealAnalysisFailureReason: null,
        mealHeadline: '油炸偏多',
        mealCalorieMin: 520,
        mealCalorieMax: 780,
        mealCalorieBucket: 'medium',
        createdAt: new Date('2026-06-18T04:00:00.000Z'),
      },
    ]);

    const results = await service.executeMany(buildContext(), [
      { name: 'get_meal_analysis_digest', args: { days: 14, limit: 5 } },
    ]);

    // The model's `days` argument — not the user message text — drives the window.
    expect(deps.dailyRecordReaderPort.listFactsInRange).toHaveBeenCalledWith(
      'user-1',
      new Date(Date.UTC(2026, 5, 6)),
      new Date(Date.UTC(2026, 5, 19)),
      ['meal'],
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('get_meal_analysis_digest');
    expect(results[0]?.data).toMatchObject({
      query: { days: 14, limit: 5, requestedDays: 14, requestedLimit: 5 },
      coverage: { status: 'complete', reason: null },
      result: {
        total: 1,
        meals: [
          {
            date: '2026-06-18',
            occurredTime: '12:30',
            title: '午饭',
            headline: '油炸偏多',
            calorieRange: {
              min: 520,
              max: 780,
              unit: 'kcal',
              bucket: 'medium',
            },
          },
        ],
      },
    });
  });

  it('serves repeated knowledge queries from the tool cache', async () => {
    const { service, deps } = buildExecutor();
    const cachedResult = {
      name: 'search_cn_medicine_products',
      data: {
        query: {},
        result: { products: [{ id: 'p1' }] },
        coverage: { status: 'complete' },
        ambiguities: [],
      },
    };
    deps.cache.get.mockResolvedValue(JSON.stringify(cachedResult));

    const result = await service.executeMany(
      buildContext({ userMessage: '查一下阿司匹林的厂家' }),
      toolCalls('search_cn_medicine_products'),
    );

    expect(result).toEqual([cachedResult]);
    // Cache hit: the underlying retrieval service must not run again.
    expect(
      deps.medicineLookupService.searchCnMedicineProducts,
    ).not.toHaveBeenCalled();
    expect(deps.cache.get).toHaveBeenCalledTimes(1);
  });

  it('returns one persisted today summary for a specific date', async () => {
    const { service, deps } = buildExecutor();
    deps.aiSummaryHistoryService.getLatestTodaySummaryByDate.mockResolvedValue({
      date: '2026-06-17',
      generatedAt: '2026-06-17T09:00:00.000Z',
      summary: 'Yesterday was steadier.',
      bullets: [],
      actionLabel: 'Keep it up',
      confidenceNote: 'Based on stored summary.',
    });

    const results = await service.executeMany(
      buildContext(),
      toolCalls('get_today_summary_by_date'),
    );

    expect(
      deps.aiSummaryHistoryService.getLatestTodaySummaryByDate,
    ).toHaveBeenCalledWith('user-1', '2026-06-17');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: 'get_today_summary_by_date',
      data: {
        query: {
          date: '2026-06-17',
          matchedBy: ['explicit_iso_date'],
        },
        result: {
          summary: {
            date: '2026-06-17',
            generatedAt: '2026-06-17T09:00:00.000Z',
            summary: 'Yesterday was steadier.',
            bullets: [],
            actionLabel: 'Keep it up',
            confidenceNote: 'Based on stored summary.',
          },
          found: true,
        },
        coverage: {
          status: 'complete',
          reason: null,
        },
        timeRange: {
          timezone: 'UTC',
          startDate: '2026-06-17',
          endDate: '2026-06-17',
        },
        source: {
          tool: 'get_today_summary_by_date',
          tables: ['historical_ai_summary'],
        },
        confidence: {
          level: 'high',
          reason: 'Checked persisted Today AI summaries for one specific date.',
        },
        ambiguities: [],
      },
    });

    const source = results[0]?.data['source'] as Record<string, unknown> | null;
    expect(
      source != null && typeof source['generatedAt'] === 'string'
        ? source['generatedAt']
        : null,
    ).toEqual(expect.any(String));
  });

  it('matches the more specific record for update proposals', async () => {
    const { service, deps } = buildExecutor();
    deps.dailyRecordsService.list.mockResolvedValue({
      items: [
        {
          id: 'water-1',
          kind: DailyRecordKind.water,
          occurredAt: '2026-06-19',
          title: null,
          value: '300',
          unit: 'ml',
          note: 'after class',
          payload: null,
          createdAt: '2026-06-19T01:00:00.000Z',
          updatedAt: '2026-06-19T01:00:00.000Z',
        },
        {
          id: 'water-2',
          kind: DailyRecordKind.water,
          occurredAt: '2026-06-19',
          title: null,
          value: '200',
          unit: 'ml',
          note: 'before class',
          payload: null,
          createdAt: '2026-06-19T00:30:00.000Z',
          updatedAt: '2026-06-19T00:30:00.000Z',
        },
      ],
    });

    const results = await service.executeMany(
      buildContext({
        locale: 'zh-CN',
        userMessage: '把今天那条 300ml 饮水记录备注改成 课后补水',
        enabledContextSources: ['daily_records'],
      }),
      toolCalls('propose_update_daily_record'),
    );

    expect(deps.dailyRecordsService.list).toHaveBeenCalledWith(
      'user-1',
      '2026-06-19',
      undefined,
      1,
      100,
    );
    expect(results[0]?.proposedActions?.[0]).toMatchObject({
      type: 'update_daily_record',
      target: {
        kind: 'daily_record',
        recordId: 'water-1',
        matchedBy: ['relative_today', 'kind', 'value'],
      },
      payloadVersion: 1,
      payload: {
        type: 'update_daily_record',
        recordId: 'water-1',
        draft: {
          value: '300',
          unit: 'ml',
          note: '课后补水',
        },
      },
    });
    expect(results[0]?.proposedActions?.[0]?.constraints).toEqual(
      expect.any(Array),
    );
    expect(results[0]?.proposedActions?.[0]?.expiresAt).toEqual(
      expect.any(String),
    );
  });

  it('refuses update proposal when message is too vague to identify one record', async () => {
    const { service, deps } = buildExecutor();
    deps.dailyRecordsService.list.mockResolvedValue({
      items: [
        {
          id: 'water-1',
          kind: DailyRecordKind.water,
          occurredAt: '2026-06-19',
          title: null,
          value: '300',
          unit: 'ml',
          note: 'after class',
          payload: null,
          createdAt: '2026-06-19T01:00:00.000Z',
          updatedAt: '2026-06-19T01:00:00.000Z',
        },
        {
          id: 'water-2',
          kind: DailyRecordKind.water,
          occurredAt: '2026-06-19',
          title: null,
          value: '200',
          unit: 'ml',
          note: 'before class',
          payload: null,
          createdAt: '2026-06-19T00:30:00.000Z',
          updatedAt: '2026-06-19T00:30:00.000Z',
        },
      ],
    });

    const results = await service.executeMany(
      buildContext({
        locale: 'zh-CN',
        userMessage: '把今天那条饮水记录改一下',
        enabledContextSources: ['daily_records'],
      }),
      toolCalls('propose_update_daily_record'),
    );

    expect(results[0]?.proposedActions).toBeUndefined();
    expect(results[0]?.data).toMatchObject({
      matchedRecord: null,
      candidateCount: 2,
      confidence: {
        level: 'low',
      },
    });
    expect(results[0]?.data['selectedDate']).toBe('2026-06-19');
    expect(results[0]?.data['ambiguities']).toEqual(
      expect.arrayContaining([
        'Kind alone is not specific enough to mutate a record safely.',
      ]),
    );
  });

  it('includes target metadata for create proposals', async () => {
    const { service, deps } = buildExecutor();
    deps.dailyRecordCandidatesService.generate.mockResolvedValue({
      confirmationHint: 'Please review it first.',
      items: [
        {
          kind: 'water',
          occurredAt: '2026-06-19',
          title: null,
          value: '300',
          unit: 'ml',
          note: null,
          payload: null,
          rationale: 'Detected water intake.',
        },
      ],
    });

    const results = await service.executeMany(
      buildContext({
        userMessage: 'I drank 300ml water today',
        enabledContextSources: ['daily_records'],
      }),
      toolCalls('propose_create_daily_record'),
    );

    expect(deps.dailyRecordCandidatesService.generate).toHaveBeenCalledWith(
      'user-1',
      {
        text: 'I drank 300ml water today',
        occurredAt: '2026-06-19',
      },
      'en',
    );
    expect(results[0]?.proposedActions?.[0]).toMatchObject({
      type: 'create_daily_record',
      target: {
        kind: 'daily_record_draft',
        matchedBy: ['relative_today'],
      },
      payload: {
        type: 'create_daily_record',
        draft: {
          kind: 'water',
          occurredAt: '2026-06-19',
          value: '300',
          unit: 'ml',
        },
      },
    });

    const firstAction = results[0]?.proposedActions?.[0];
    if (firstAction == null) {
      throw new Error('expected first proposed action');
    }
    expect(firstAction.target.label).toEqual(expect.stringContaining('water'));
    expect(firstAction.constraints).toEqual(expect.any(Array));
    expect(firstAction.expiresAt).toEqual(expect.any(String));
  });

  it('returns a timeout envelope when a tool exceeds the per-tool timeout (F-6)', async () => {
    const { service, deps } = buildExecutor();
    deps.aiSummaryHistoryService.getLatestTodaySummaryByDate.mockReturnValue(
      new Promise(() => {
        // never settles
      }),
    );

    const pending = service.executeMany(
      buildContext(),
      toolCalls('get_today_summary_by_date'),
    );

    await vi.advanceTimersByTimeAsync(TOOL_EXECUTION_TIMEOUT_MS);
    const results = await pending;

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: 'get_today_summary_by_date',
      timeout: true,
      data: {
        timeout: true,
        reason: 'Tool execution timed out.',
      },
    });
    expect(results[0]?.proposedActions).toBeUndefined();
  });

  it('logs the duration when a timed-out tool rejects late', async () => {
    const { service, deps } = buildExecutor();
    let rejectLate!: (reason: unknown) => void;
    deps.aiSummaryHistoryService.getLatestTodaySummaryByDate.mockReturnValue(
      new Promise((_, reject) => {
        rejectLate = reject;
      }),
    );
    const logger = (
      service as unknown as { logger: { warn: (...args: unknown[]) => void } }
    ).logger;
    const warnSpy = vi.spyOn(logger, 'warn');

    const pending = service.executeMany(
      buildContext(),
      toolCalls('get_today_summary_by_date'),
    );
    await vi.advanceTimersByTimeAsync(TOOL_EXECUTION_TIMEOUT_MS);
    await pending;
    rejectLate(new Error('late tool failure'));
    for (let index = 0; index < 4; index += 1) {
      await Promise.resolve();
    }

    expect(
      warnSpy.mock.calls.some(
        ([message]) =>
          typeof message === 'string' &&
          /Tool "get_today_summary_by_date" failed after timeout/.test(message),
      ),
    ).toBe(true);
    expect(
      warnSpy.mock.calls.some(
        ([message]) =>
          typeof message === 'string' && /durationMs=\d+/.test(message),
      ),
    ).toBe(true);
  });

  it('degrades to uncached execution when cache get fails', async () => {
    const { service, deps } = buildExecutor();
    deps.cache.get.mockRejectedValueOnce(new Error('Redis connection refused'));
    const logger = (service as unknown as { logger: { warn: vi.Mock } }).logger;
    const warnSpy = vi.spyOn(logger, 'warn');

    const results = await service.executeMany(
      buildContext({ userMessage: '查一下阿司匹林的厂家' }),
      toolCalls('search_cn_medicine_products'),
    );

    expect(results).toHaveLength(1);
    // The underlying retrieval service must have been called (cache miss → fallback).
    expect(
      deps.medicineLookupService.searchCnMedicineProducts,
    ).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Assistant tool cache get failed'),
    );
  });

  it('returns the result even when cache set fails', async () => {
    const { service, deps } = buildExecutor();
    deps.cache.set.mockRejectedValueOnce(new Error('Redis connection refused'));
    const logger = (service as unknown as { logger: { warn: vi.Mock } }).logger;
    const warnSpy = vi.spyOn(logger, 'warn');

    const results = await service.executeMany(
      buildContext({ userMessage: '查一下阿司匹林的厂家' }),
      toolCalls('search_cn_medicine_products'),
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('search_cn_medicine_products');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Assistant tool cache set failed'),
    );
  });

  it('runs read tools in parallel and preserves the input order (F-6)', async () => {
    const { service, deps } = buildExecutor();
    let releaseSummary!: (value: unknown) => void;
    const summaryGate = new Promise((resolve) => {
      releaseSummary = resolve;
    });
    deps.aiSummaryHistoryService.getLatestTodaySummaryByDate.mockReturnValue(
      summaryGate.then(() => ({
        date: '2026-06-17',
        generatedAt: '2026-06-17T09:00:00.000Z',
        summary: 'Yesterday was steadier.',
        bullets: [],
        actionLabel: 'Keep it up',
        confidenceNote: 'Based on stored summary.',
      })),
    );
    deps.dailyRecordsService.list.mockResolvedValue({ items: [] });

    const pending = service.executeMany(
      buildContext(),
      toolCalls('get_today_summary_by_date', 'get_today_records'),
    );

    // Both read tools must already be running while the summary tool is still
    // blocked on its gate — evidence of parallel start, not serial execution.
    expect(
      deps.aiSummaryHistoryService.getLatestTodaySummaryByDate,
    ).toHaveBeenCalled();
    expect(deps.dailyRecordsService.list).toHaveBeenCalled();

    releaseSummary!({});
    const results = await pending;

    expect(results.map((result) => result.name)).toEqual([
      'get_today_summary_by_date',
      'get_today_records',
    ]);
  });

  it('keeps proposal tools serial (F-6)', async () => {
    const { service, deps } = buildExecutor();
    let releaseList!: (value: unknown) => void;
    const listGate = new Promise((resolve) => {
      releaseList = resolve;
    });
    const listMock = vi
      .fn()
      .mockReturnValueOnce(listGate)
      .mockResolvedValueOnce({ items: [] });
    deps.dailyRecordsService.list = listMock;

    const pending = service.executeMany(
      buildContext({ userMessage: '把今天那条记录改一下' }),
      toolCalls('propose_update_daily_record', 'propose_delete_daily_record'),
    );

    // The first proposal tool is blocked on the gate; the second must NOT have
    // started yet (serial execution).
    await Promise.resolve();
    expect(listMock).toHaveBeenCalledTimes(1);

    releaseList!({ items: [] });
    const results = await pending;

    expect(results.map((result) => result.name)).toEqual([
      'propose_update_daily_record',
      'propose_delete_daily_record',
    ]);
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
