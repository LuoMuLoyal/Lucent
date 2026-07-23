import { DailyRecordKind } from '#generated/prisma/client';
import type { AssistantToolExecutionContext } from '../types';
import { AssistantToolLeafletReadService } from './leaflet/read.service';
import { AssistantToolDrugbankEntityResolveService } from './drugbank/entity-resolve.service';
import { AssistantToolDrugbankSearchService } from './drugbank/search.service';
import type { AssistantToolMedicineLookupService } from './medicine/lookup.service';
import { AssistantToolProposalService } from './proposal.service';
import { AssistantToolReadService } from './read.service';
import { AssistantToolRecordQueryService } from './records/query.service';
import { AssistantToolService } from './tool.service';

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
    const dailyRecordCandidatesService = {
      generate: vi.fn(),
    };

    const recordQueryService = new AssistantToolRecordQueryService(
      dailyRecordsService as never,
    );
    const readService = new AssistantToolReadService(
      {} as never,
      aiSummaryHistoryService as never,
      userHealthContextService as never,
      medicineRemindersService as never,
      userSettingsService as never,
      recordQueryService,
    );
    const proposalService = new AssistantToolProposalService(
      dailyRecordCandidatesService as never,
      recordQueryService,
    );
    const leafletReadService = new AssistantToolLeafletReadService(
      {
        cnMedicineProduct: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        cnMedicineProductLeafletLink: {
          count: vi.fn().mockResolvedValue(0),
        },
        medicineLeafletChunk: {
          count: vi.fn().mockResolvedValue(0),
        },
      } as never,
      { getStore: vi.fn() } as never,
    );
    const medicalKnowledgeService = {
      searchMedicalQaCorpus: vi.fn().mockResolvedValue({
        query: {},
        result: { knowledge: [] },
        coverage: { status: 'empty', reason: 'No query was provided.' },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        source: {
          tool: 'search_medical_qa_corpus',
          generatedAt: new Date().toISOString(),
          tables: ['medical_qa_embeddings'],
        },
        confidence: { level: 'low', reason: 'Empty query.' },
        ambiguities: [],
      }),
    } as never;
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
    const service = new AssistantToolService(
      readService,
      leafletReadService,
      medicalKnowledgeService,
      drugbankEntityResolveService,
      drugbankSearchService,
      medicineLookupService as never,
      proposalService,
    );

    return {
      service,
      deps: {
        aiSummaryHistoryService,
        dailyRecordCandidatesService,
        dailyRecordsService,
        medicineRemindersService,
        medicineLookupService,
        recordQueryService,
        userHealthContextService,
        userSettingsService,
      },
    };
  }

  it('dispatches the new retrieval tools', async () => {
    const { service, deps } = buildExecutor();

    await expect(
      service.executeMany(buildContext(), [
        'search_cn_medicine_products',
        'get_cn_medicine_detail',
        'get_drugbank_detail',
        'search_medicine_leaflets',
        'search_medical_qa_corpus',
        'resolve_drugbank_entity',
        'search_drugbank_passages',
      ]),
    ).resolves.toHaveLength(7);

    expect(
      deps.medicineLookupService.searchCnMedicineProducts,
    ).toHaveBeenCalled();
    expect(deps.medicineLookupService.getCnMedicineDetail).toHaveBeenCalled();
    expect(deps.medicineLookupService.getDrugbankDetail).toHaveBeenCalled();
  });

  it('passes a resolved CN product id into downstream leaflet retrieval', async () => {
    const { service, deps } = buildExecutor();
    const leafletSpy = vi
      .spyOn(
        AssistantToolLeafletReadService.prototype,
        'searchMedicineLeaflets',
      )
      .mockResolvedValue({
        query: {},
        result: { chunks: [] },
        coverage: { status: 'empty', reason: 'No query was provided.' },
        timeRange: { timezone: 'UTC', startDate: null, endDate: null },
        source: {
          tool: 'search_medicine_leaflets',
          generatedAt: new Date().toISOString(),
          tables: ['medicine_leaflet_chunks'],
        },
        confidence: { level: 'low', reason: 'Empty query.' },
        ambiguities: [],
      });

    (
      deps.medicineLookupService.getCnMedicineDetail as vi.Mock
    ).mockResolvedValue({
      query: {
        query: '阿司匹林肠溶片',
        matchedSource: 'cn',
        productId: 'prod-1',
      },
      result: {
        product: {
          id: 'prod-1',
          name: '阿司匹林肠溶片',
        },
        candidates: [],
      },
      coverage: { status: 'complete', reason: null },
      timeRange: { timezone: 'UTC', startDate: null, endDate: null },
      source: {
        tool: 'get_cn_medicine_detail',
        generatedAt: new Date().toISOString(),
        tables: ['cn_medicine_products'],
      },
      confidence: {
        level: 'high',
        reason: 'Loaded one structured Chinese medicine detail record.',
      },
      ambiguities: [],
    });

    await service.executeMany(
      buildContext({
        locale: 'zh-CN',
        userMessage: '阿司匹林肠溶片的禁忌和不良反应是什么',
      }),
      ['get_cn_medicine_detail', 'search_medicine_leaflets'],
    );

    expect(leafletSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'zh-CN',
      }),
    );
    const leafletContext = leafletSpy.mock.calls[0]?.[0];
    expect(leafletContext?.userMessage).toContain('"productId":"prod-1"');
    expect(leafletContext?.userMessage).toContain(
      '"query":"阿司匹林肠溶片的禁忌和不良反应是什么"',
    );

    leafletSpy.mockRestore();
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

    const results = await service.executeMany(buildContext(), [
      'get_today_summary_by_date',
    ]);

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
      ['propose_update_daily_record'],
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
      ['propose_update_daily_record'],
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
      ['propose_create_daily_record'],
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
});
