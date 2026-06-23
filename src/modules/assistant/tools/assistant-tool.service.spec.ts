import { DailyRecordKind } from '../../../generated/prisma/client';
import type { AssistantToolExecutionContext } from '../types/assistant.types';
import { AssistantToolProposalService } from './assistant-tool-proposal.service';
import { AssistantToolReadService } from './assistant-tool-read.service';
import { AssistantToolRecordQueryService } from './assistant-tool-record-query.service';
import { AssistantToolService } from './assistant-tool.service';

describe('AssistantToolService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-19T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
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
      getLatestTodaySummaryByDate: jest.fn(),
      getLatestReportSummaryByRange: jest.fn(),
      listRecentTodaySummaries: jest.fn(),
      listRecentReportSummaries: jest.fn(),
    };
    const userHealthContextService = {
      getForUser: jest.fn(),
    };
    const medicineRemindersService = {
      list: jest.fn(),
    };
    const userSettingsService = {
      getSettings: jest.fn(),
    };
    const dailyRecordsService = {
      list: jest.fn(),
    };
    const dailyRecordCandidatesService = {
      generate: jest.fn(),
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
    const service = new AssistantToolService(readService, proposalService);

    return {
      service,
      deps: {
        aiSummaryHistoryService,
        dailyRecordCandidatesService,
        dailyRecordsService,
        medicineRemindersService,
        recordQueryService,
        userHealthContextService,
        userSettingsService,
      },
    };
  }

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
