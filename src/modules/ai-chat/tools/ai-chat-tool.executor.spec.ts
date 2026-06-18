import { DailyRecordKind } from '../../../generated/prisma/client';
import { AiChatToolExecutor } from './ai-chat-tool.executor';

describe('AiChatToolExecutor', () => {
  function buildExecutor() {
    return new AiChatToolExecutor(
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
          aiChatEnabled: true,
          aiChatMemoryEnabled: false,
          aiChatContext: {
            healthProfile: true,
            dailyRecords: true,
            sleepRecords: true,
            currentMedicines: true,
          },
        }),
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

    expect(results).toEqual([
      {
        name: 'get_today_summary_by_date',
        data: {
          date: '2026-06-17',
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
      },
    ]);
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

    expect(results[0]?.proposedActions?.[0]?.payload).toEqual({
      type: 'update_daily_record',
      recordId: 'water-1',
      draft: {
        value: '300',
        unit: 'ml',
        note: '课后补水',
      },
    });
  });
});
