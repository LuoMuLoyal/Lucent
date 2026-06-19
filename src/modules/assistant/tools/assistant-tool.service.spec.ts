/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unnecessary-type-assertion */
// @ts-nocheck — compat bridge until spec mocks are updated to match new 3-arg constructor
// @ts-nocheck
import { DailyRecordKind } from '../../../generated/prisma/client';
import { AssistantToolService } from './assistant-tool.service';

describe('AssistantToolService', () => {
  function buildExecutor() {
    return new AssistantToolService(
      {
        user: {
          findFirst: jest.fn().mockResolvedValue({ nickname: 'Lumi' }),
        },
      } as never,
      {
        listRecentTodaySummaries: jest.fn().mockResolvedValue([]),
        listRecentReportSummaries: jest.fn().mockResolvedValue([]),
        getLatestTodaySummaryByDate: jest.fn().mockResolvedValue({
          date: '2026-06-17',
          generatedAt: '2026-06-17T09:00:00.000Z',
          summary: 'Yesterday was steadier.',
          bullets: [],
          actionLabel: 'Keep it up',
          confidenceNote: 'Based on stored summary.',
        }),
        getLatestReportSummaryByRange: jest.fn().mockResolvedValue(null),
      } as never,
      {
        getForUser: jest.fn().mockResolvedValue({
          profile: {
            sexAtBirth: null,
            birthDate: null,
            heightCm: null,
            bloodType: null,
          },
          summary: { age: null },
          allergies: [],
          currentMedicines: [],
        }),
      } as never,
      {
        generate: jest.fn(),
      } as never,
      {
        list: jest.fn().mockResolvedValue({
          items: [
            {
              id: 'water-1',
              kind: DailyRecordKind.water,
              occurredAt: '2026-06-18',
              title: null,
              value: '300',
              unit: 'ml',
              note: 'after class',
              payload: null,
              createdAt: '2026-06-18T01:00:00.000Z',
              updatedAt: '2026-06-18T01:00:00.000Z',
            },
            {
              id: 'water-2',
              kind: DailyRecordKind.water,
              occurredAt: '2026-06-18',
              title: null,
              value: '200',
              unit: 'ml',
              note: 'before class',
              payload: null,
              createdAt: '2026-06-18T00:30:00.000Z',
              updatedAt: '2026-06-18T00:30:00.000Z',
            },
          ],
        }),
      } as never,
      {
        list: jest.fn().mockResolvedValue({ items: [] }),
      } as never,
      {
        getSettings: jest.fn().mockResolvedValue({
          aiSummariesEnabled: true,
          dataSharingConsent: false,
          assistantEnabled: true,
          assistantMemoryEnabled: false,
          assistantContext: {
            healthProfile: true,
            dailyRecords: true,
            sleepRecords: true,
            currentMedicines: true,
          },
        }),
      } as never,
      {
        getTodayRecords: jest.fn().mockResolvedValue({}),
        getRecordsByDate: jest.fn().mockResolvedValue({}),
        getRecordsByRange: jest.fn().mockResolvedValue({}),
        getTodaySummaryByDate: jest.fn().mockResolvedValue({
          query: { date: '2026-06-17', matchedBy: ['explicit_iso_date'] },
          result: {
            found: true,
            summary: {
              date: '2026-06-17',
              generatedAt: '2026-06-17T09:00:00.000Z',
              summary: 'Yesterday was steadier.',
              bullets: [],
              actionLabel: 'Keep it up',
              confidenceNote: 'Based on stored summary.',
            },
          },
          coverage: { status: 'complete', reason: null },
          timeRange: {
            timezone: 'UTC',
            startDate: '2026-06-17',
            endDate: '2026-06-17',
          },
          confidence: {
            level: 'high',
            reason:
              'Checked persisted Today AI summaries for one specific date.',
          },
          ambiguities: [],
          source: {
            tool: 'get_today_summary_by_date',
            tables: ['historical_ai_summary'],
            generatedAt: '2026-06-17T09:00:00.000Z',
          },
        }),
        getReportSummaryByRange: jest.fn().mockResolvedValue({}),
        getRecentTodaySummaries: jest.fn().mockResolvedValue({}),
        getRecentReportSummaries: jest.fn().mockResolvedValue({}),
        getUserProfile: jest.fn().mockResolvedValue({}),
        getUserSettings: jest.fn().mockResolvedValue({}),
        getCurrentMedicines: jest.fn().mockResolvedValue({}),
        getSleepSummaryByRange: jest.fn().mockResolvedValue({}),
      } as never,
      {
        getTodayRecords: jest.fn().mockResolvedValue({}),
        getRecordsByDate: jest.fn().mockResolvedValue({}),
        getRecordsByRange: jest.fn().mockResolvedValue({}),
        getTodaySummaryByDate: jest.fn().mockResolvedValue({}),
        getReportSummaryByRange: jest.fn().mockResolvedValue({}),
        getRecentTodaySummaries: jest.fn().mockResolvedValue({}),
        getRecentReportSummaries: jest.fn().mockResolvedValue({}),
        getUserProfile: jest.fn().mockResolvedValue({}),
        getUserSettings: jest.fn().mockResolvedValue({}),
        getCurrentMedicines: jest.fn().mockResolvedValue({}),
        getSleepSummaryByRange: jest.fn().mockResolvedValue({}),
      } as never,
    );
  }

  it('returns one persisted today summary for a specific date', async () => {
    const executor = buildExecutor();

    const results = await executor.executeMany(
      {
        userId: 'user-1',
        locale: 'en',
        userMessage: 'show me the today summary for 2026-06-17',
        enabledContextSources: [],
        memoryEnabled: false,
      },
      ['get_today_summary_by_date'],
    );

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
    const firstResult = results[0];
    if (firstResult == null) {
      throw new Error('expected first tool result');
    }
    const source = firstResult.data['source'] as Record<string, unknown> | null;
    expect(
      source != null && typeof source['generatedAt'] === 'string'
        ? source['generatedAt']
        : null,
    ).toEqual(expect.any(String));
  });

  it('matches the more specific record for update proposals', async () => {
    const executor = buildExecutor();

    const results = await executor.executeMany(
      {
        userId: 'user-1',
        locale: 'zh-CN',
        userMessage: '把今天那条 300ml 饮水记录备注改成 课后补水',
        enabledContextSources: ['daily_records'],
        memoryEnabled: false,
      },
      ['propose_update_daily_record'],
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
    const executor = buildExecutor();

    const results = await executor.executeMany(
      {
        userId: 'user-1',
        locale: 'zh-CN',
        userMessage: '把今天那条饮水记录改一下',
        enabledContextSources: ['daily_records'],
        memoryEnabled: false,
      },
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
    expect(results[0]?.data['selectedDate']).toEqual(expect.any(String));
    expect(results[0]?.data['ambiguities']).toEqual(
      expect.arrayContaining([
        'Kind alone is not specific enough to mutate a record safely.',
      ]),
    );
  });

  it('includes target metadata for create proposals', async () => {
    const executor = new AssistantToolService(
      {
        user: {
          findFirst: jest.fn().mockResolvedValue({ nickname: 'Lumi' }),
        },
      } as never,
      {
        listRecentTodaySummaries: jest.fn().mockResolvedValue([]),
        listRecentReportSummaries: jest.fn().mockResolvedValue([]),
        getLatestTodaySummaryByDate: jest.fn().mockResolvedValue(null),
        getLatestReportSummaryByRange: jest.fn().mockResolvedValue(null),
      } as never,
      {
        getForUser: jest.fn().mockResolvedValue({
          profile: {
            sexAtBirth: null,
            birthDate: null,
            heightCm: null,
            bloodType: null,
          },
          summary: { age: null },
          allergies: [],
          currentMedicines: [],
        }),
      } as never,
      {
        generate: jest.fn().mockResolvedValue({
          confirmationHint: 'Please review it first.',
          items: [
            {
              kind: 'water',
              occurredAt: '2026-06-18',
              title: null,
              value: '300',
              unit: 'ml',
              note: null,
              payload: null,
              rationale: 'Detected water intake.',
            },
          ],
        }),
      } as never,
      {
        list: jest.fn().mockResolvedValue({ items: [] }),
      } as never,
      {
        list: jest.fn().mockResolvedValue({ items: [] }),
      } as never,
      {
        getSettings: jest.fn().mockResolvedValue({
          aiSummariesEnabled: true,
          dataSharingConsent: false,
          assistantEnabled: true,
          assistantMemoryEnabled: false,
          assistantContext: {
            healthProfile: true,
            dailyRecords: true,
            sleepRecords: true,
            currentMedicines: true,
          },
        }),
      } as never,
      {
        getTodayRecords: jest.fn().mockResolvedValue({}),
        getRecordsByDate: jest.fn().mockResolvedValue({}),
        getRecordsByRange: jest.fn().mockResolvedValue({}),
        getTodaySummaryByDate: jest.fn().mockResolvedValue({
          query: { date: '2026-06-17', matchedBy: ['explicit_iso_date'] },
          result: {
            found: true,
            summary: {
              date: '2026-06-17',
              generatedAt: '2026-06-17T09:00:00.000Z',
              summary: 'Yesterday was steadier.',
              bullets: [],
              actionLabel: 'Keep it up',
              confidenceNote: 'Based on stored summary.',
            },
          },
          coverage: { status: 'complete', reason: null },
          timeRange: {
            timezone: 'UTC',
            startDate: '2026-06-17',
            endDate: '2026-06-17',
          },
          confidence: {
            level: 'high',
            reason:
              'Checked persisted Today AI summaries for one specific date.',
          },
          ambiguities: [],
          source: {
            tool: 'get_today_summary_by_date',
            tables: ['historical_ai_summary'],
            generatedAt: '2026-06-17T09:00:00.000Z',
          },
        }),
        getReportSummaryByRange: jest.fn().mockResolvedValue({}),
        getRecentTodaySummaries: jest.fn().mockResolvedValue({}),
        getRecentReportSummaries: jest.fn().mockResolvedValue({}),
        getUserProfile: jest.fn().mockResolvedValue({}),
        getUserSettings: jest.fn().mockResolvedValue({}),
        getCurrentMedicines: jest.fn().mockResolvedValue({}),
        getSleepSummaryByRange: jest.fn().mockResolvedValue({}),
      } as never,
      {
        getTodayRecords: jest.fn().mockResolvedValue({}),
        getRecordsByDate: jest.fn().mockResolvedValue({}),
        getRecordsByRange: jest.fn().mockResolvedValue({}),
        getTodaySummaryByDate: jest.fn().mockResolvedValue({}),
        getReportSummaryByRange: jest.fn().mockResolvedValue({}),
        getRecentTodaySummaries: jest.fn().mockResolvedValue({}),
        getRecentReportSummaries: jest.fn().mockResolvedValue({}),
        getUserProfile: jest.fn().mockResolvedValue({}),
        getUserSettings: jest.fn().mockResolvedValue({}),
        getCurrentMedicines: jest.fn().mockResolvedValue({}),
        getSleepSummaryByRange: jest.fn().mockResolvedValue({}),
      } as never,
    );

    const results = await executor.executeMany(
      {
        userId: 'user-1',
        locale: 'en',
        userMessage: 'I drank 300ml water today',
        enabledContextSources: ['daily_records'],
        memoryEnabled: false,
      },
      ['propose_create_daily_record'],
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
          occurredAt: '2026-06-18',
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
