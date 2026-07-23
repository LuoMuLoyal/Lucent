import type { DeepMocked } from '../../../common/types/deep-mocked';
import type { PrismaService } from '../../../prisma';
import type { HistoricalAiSummaryService } from '../services/historical-ai-summary.service';
import type { UserHealthContextService } from '../../user-health-context/services';
import type { IMedicineReminderReader } from '../types/ports';
import type { UserSettingsService } from '../../user-settings/services/user-settings.service';
import type { AssistantToolRecordQueryService } from './records/query.service';
import type { AssistantToolExecutionContext } from '../types';
import { AssistantToolReadService } from './read.service';

const mockContext: AssistantToolExecutionContext = {
  userId: 'user-1',
  locale: 'zh-CN',
  userMessage: '我今天的记录',
  enabledContextSources: ['daily_records', 'sleep_records'],
  memoryEnabled: false,
};

const mockContextNoSleep: AssistantToolExecutionContext = {
  ...mockContext,
  enabledContextSources: ['daily_records'],
};

describe('AssistantToolReadService', () => {
  let service: AssistantToolReadService;
  let prisma: DeepMocked<PrismaService>;
  let aiSummary: vi.Mocked<HistoricalAiSummaryService>;
  let healthContext: vi.Mocked<UserHealthContextService>;
  let reminders: vi.Mocked<IMedicineReminderReader>;
  let userSettings: vi.Mocked<UserSettingsService>;
  let recordQuery: vi.Mocked<AssistantToolRecordQueryService>;

  beforeEach(() => {
    prisma = {
      user: { findFirstOrThrow: vi.fn() },
    } as unknown as DeepMocked<PrismaService>;

    aiSummary = {
      getLatestTodaySummaryByDate: vi.fn(),
      getLatestReportSummaryByRange: vi.fn(),
      listRecentTodaySummaries: vi.fn(),
      listRecentReportSummaries: vi.fn(),
    } as unknown as vi.Mocked<HistoricalAiSummaryService>;

    healthContext = {
      getForUser: vi.fn(),
    } as unknown as vi.Mocked<UserHealthContextService>;

    reminders = {
      list: vi.fn(),
    } as unknown as vi.Mocked<IMedicineReminderReader>;

    userSettings = {
      getSettings: vi.fn(),
    } as unknown as vi.Mocked<UserSettingsService>;

    recordQuery = {
      listToolRecords: vi.fn(),
      resolveSingleDate: vi.fn(),
      findTargetDailyRecordForMutation: vi.fn(),
    } as unknown as vi.Mocked<AssistantToolRecordQueryService>;

    service = new AssistantToolReadService(
      prisma,
      aiSummary,
      healthContext,
      reminders,
      userSettings,
      recordQuery,
    );
  });

  describe('canReadSleep', () => {
    it('returns true when sleep_records is in enabledContextSources', () => {
      expect(service.canReadSleep(mockContext)).toBe(true);
    });

    it('returns false when sleep_records is not in enabledContextSources', () => {
      expect(service.canReadSleep(mockContextNoSleep)).toBe(false);
    });
  });

  describe('getTodayRecords', () => {
    it('returns today records with sleep included', async () => {
      const records = [
        { id: 'r1', kind: 'water', occurredAt: '2026-07-10T08:00:00.000Z' },
      ];
      recordQuery.listToolRecords.mockResolvedValue(records as never);

      const result = await service.getTodayRecords(mockContext);

      expect(result.source.tool).toBe('get_today_records');
      expect(result.result).toHaveProperty('total', 1);
      expect(result.coverage.status).toBe('complete');
      expect(result.confidence.level).toBe('high');
    });

    it('returns empty coverage when no records', async () => {
      recordQuery.listToolRecords.mockResolvedValue([]);

      const result = await service.getTodayRecords(mockContext);

      expect(result.coverage.status).toBe('empty');
      expect(result.result).toHaveProperty('total', 0);
    });
  });

  describe('getRecordsByDate', () => {
    it('resolves date and returns records', async () => {
      recordQuery.listToolRecords.mockResolvedValue([]);

      const result = await service.getRecordsByDate({
        ...mockContext,
        userMessage: '2026-07-09的记录',
      });

      expect(result.source.tool).toBe('get_records_by_date');
      expect(result.query).toHaveProperty('date');
    });
  });

  describe('getRecordsByRange', () => {
    it('returns range records with days array', async () => {
      recordQuery.listToolRecords.mockResolvedValue([]);

      const result = await service.getRecordsByRange({
        ...mockContext,
        userMessage: '最近7天的记录',
      });

      expect(result.source.tool).toBe('get_records_by_range');
      expect(result.result).toHaveProperty('days');
      expect(result.result).toHaveProperty('total');
    });
  });

  describe('getTodaySummaryByDate', () => {
    it('returns found summary', async () => {
      recordQuery.resolveSingleDate.mockReturnValue({
        date: '2026-07-10',
        matchedBy: ['fallback'],
        ambiguities: [],
      });
      aiSummary.getLatestTodaySummaryByDate.mockResolvedValue({
        date: '2026-07-10',
        generatedAt: '2026-07-10T08:00:00.000Z',
        summary: 'Summary',
        bullets: [],
        actionLabel: 'Act',
        action: '/go',
        confidenceNote: 'high',
      });

      const result = await service.getTodaySummaryByDate(mockContext);

      expect(result.source.tool).toBe('get_today_summary_by_date');
      expect(result.result).toHaveProperty('found', true);
      expect(result.coverage.status).toBe('complete');
    });

    it('returns empty coverage when no summary', async () => {
      recordQuery.resolveSingleDate.mockReturnValue({
        date: '2026-07-10',
        matchedBy: ['fallback'],
        ambiguities: [],
      });
      aiSummary.getLatestTodaySummaryByDate.mockResolvedValue(null);

      const result = await service.getTodaySummaryByDate(mockContext);

      expect(result.result).toHaveProperty('found', false);
      expect(result.coverage.status).toBe('empty');
    });
  });

  describe('getReportSummaryByRange', () => {
    it('returns found report summary with rangeKey', async () => {
      aiSummary.getLatestReportSummaryByRange.mockResolvedValue({
        rangeKey: 'last_7_days',
        startDate: '2026-07-04',
        endDate: '2026-07-10',
        generatedAt: '2026-07-10T08:00:00.000Z',
        summary: 'Report summary',
        bullets: [],
        actionLabel: 'View',
        action: '/report',
        confidenceNote: 'medium',
      });

      const result = await service.getReportSummaryByRange({
        ...mockContext,
        userMessage: '最近7天的报告摘要',
      });

      expect(result.source.tool).toBe('get_report_summary_by_range');
      expect(result.result).toHaveProperty('found', true);
    });

    it('returns not found when no summary', async () => {
      aiSummary.getLatestReportSummaryByRange.mockResolvedValue(null);

      const result = await service.getReportSummaryByRange({
        ...mockContext,
        userMessage: 'custom range 2026-07-01 to 2026-07-10',
      });

      expect(result.result).toHaveProperty('found', false);
    });
  });

  describe('getRecentTodaySummaries', () => {
    it('returns list of recent summaries', async () => {
      aiSummary.listRecentTodaySummaries.mockResolvedValue([
        {
          date: '2026-07-10',
          generatedAt: '2026-07-10T08:00:00.000Z',
          summary: 'S1',
          bullets: [],
          actionLabel: 'A',
          action: '/a',
          confidenceNote: 'high',
        },
      ]);

      const result = await service.getRecentTodaySummaries(mockContext);

      expect(result.source.tool).toBe('get_recent_today_summaries');
      expect(result.result).toHaveProperty('total', 1);
      expect(result.coverage.status).toBe('complete');
    });

    it('returns empty coverage when no summaries', async () => {
      aiSummary.listRecentTodaySummaries.mockResolvedValue([]);

      const result = await service.getRecentTodaySummaries(mockContext);

      expect(result.coverage.status).toBe('empty');
    });
  });

  describe('getRecentReportSummaries', () => {
    it('returns list of recent report summaries', async () => {
      aiSummary.listRecentReportSummaries.mockResolvedValue([]);

      const result = await service.getRecentReportSummaries(mockContext);

      expect(result.source.tool).toBe('get_recent_report_summaries');
      expect(result.coverage.status).toBe('empty');
    });
  });

  describe('getUserProfile', () => {
    it('returns profile data', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        nickname: 'TestUser',
      });
      healthContext.getForUser.mockResolvedValue({
        profile: {
          sexAtBirth: 'male',
          birthDate: '1990-01-01',
          heightCm: 175,
          bloodType: 'A',
        },
        summary: { age: 36 },
        allergies: [
          { label: 'Penicillin', isActive: true },
          { label: 'Pollen', isActive: false },
        ],
        currentMedicines: [],
      } as never);

      const result = await service.getUserProfile(mockContext);

      expect(result.source.tool).toBe('get_user_profile');
      expect(result.result).toHaveProperty('profile');
      const profile = (
        result.result as { profile: { nickname: string; allergies: string[] } }
      ).profile;
      expect(profile.nickname).toBe('TestUser');
      expect(profile.allergies).toEqual(['Penicillin']);
    });
  });

  describe('getUserSettings', () => {
    it('returns assistant-related settings', async () => {
      userSettings.getSettings.mockResolvedValue({
        aiSummariesEnabled: true,
        dataSharingConsent: true,
        assistantEnabled: true,
        assistantMemoryEnabled: false,
        assistantContext: {
          healthProfile: true,
          dailyRecords: true,
          sleepRecords: false,
          currentMedicines: false,
        },
      } as never);

      const result = await service.getUserSettings(mockContext);

      expect(result.source.tool).toBe('get_user_settings');
      expect(result.result).toHaveProperty('settings');
    });
  });

  describe('getCurrentMedicines', () => {
    it('returns current medicines with reminder frequency', async () => {
      healthContext.getForUser.mockResolvedValue({
        profile: {},
        summary: {},
        allergies: [],
        currentMedicines: [
          {
            id: 'med-1',
            displayName: 'Ibuprofen',
            doseText: '200mg',
            route: 'oral',
            startedAt: '2026-01-01',
            note: null,
            isCurrent: true,
          },
        ],
      } as never);
      reminders.list.mockResolvedValue({
        items: [
          {
            id: 'rm-1',
            currentMedicineId: 'med-1',
            isActive: true,
            scheduledHour: 8,
            scheduledMinute: 0,
          } as never,
        ],
      });

      const result = await service.getCurrentMedicines(mockContext);

      expect(result.source.tool).toBe('get_current_medicines');
      const res = result.result as { medicines: unknown[]; total: number };
      expect(res.medicines).toHaveLength(1);
      expect(res.total).toBe(1);
    });

    it('returns empty when no current medicines', async () => {
      healthContext.getForUser.mockResolvedValue({
        profile: {},
        summary: {},
        allergies: [],
        currentMedicines: [],
      } as never);
      reminders.list.mockResolvedValue({ items: [] });

      const result = await service.getCurrentMedicines(mockContext);

      expect(result.coverage.status).toBe('empty');
    });
  });

  describe('getSleepSummaryByRange', () => {
    it('returns sleep entries with averages', async () => {
      recordQuery.listToolRecords.mockResolvedValue([
        {
          id: 'sleep-1',
          kind: 'sleep',
          occurredAt: '2026-07-09',
          payload: { durationMinutes: 420, quality: 'good' },
        } as never,
      ]);

      const result = await service.getSleepSummaryByRange({
        ...mockContext,
        userMessage: '最近3天的睡眠',
      });

      expect(result.source.tool).toBe('get_sleep_summary_by_range');
      expect(result.result).toHaveProperty('entries');
    });

    it('returns empty coverage when no sleep data', async () => {
      recordQuery.listToolRecords.mockResolvedValue([]);

      const result = await service.getSleepSummaryByRange({
        ...mockContext,
        userMessage: '最近3天的睡眠',
      });

      expect(result.coverage.status).toBe('empty');
    });
  });
});
