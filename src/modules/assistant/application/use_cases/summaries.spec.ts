import type {
  SummaryRepositoryPort,
  SummaryWrite,
  TodaySummaryRecord,
  ReportSummaryRecord,
  ReportRangeQuery,
} from '../../domain/summary/summaries.js';

import { HistoricalAiSummaryService } from './summaries.js';

describe('HistoricalAiSummaryService', () => {
  let service: HistoricalAiSummaryService;
  let repo: vi.Mocked<SummaryRepositoryPort>;

  const mockTodayRow: TodaySummaryRecord = {
    date: '2026-07-10',
    generatedAt: '2026-07-10T08:00:00.000Z',
    summary: 'Today summary text',
    bullets: [{ kind: 'highlight', text: 'Drank 1L water' }],
    actionLabel: 'Log more water',
    action: '/record/water',
    confidenceNote: 'high confidence',
    aiGenerated: true,
  };

  const mockReportRow: ReportSummaryRecord = {
    rangeKey: 'last_7_days',
    startDate: '2026-07-04',
    endDate: '2026-07-10',
    generatedAt: '2026-07-10T08:00:00.000Z',
    summary: 'Report summary text',
    bullets: [{ kind: 'trend', text: 'Sleep improving' }],
    actionLabel: 'View full report',
    action: '/report',
    confidenceNote: 'medium confidence',
  };

  beforeEach(() => {
    repo = {
      save: vi.fn().mockResolvedValue(undefined),
      listRecentToday: vi.fn(),
      listRecentReports: vi.fn(),
      findTodayByDate: vi.fn(),
      findReportByRange: vi.fn(),
    };
    service = new HistoricalAiSummaryService(repo);
  });

  describe('save', () => {
    it('delegates to repository.save', async () => {
      const input: SummaryWrite = {
        userId: 'user-1',
        kind: 'today',
        scopeKey: 'today:2026-07-10',
        date: '2026-07-10',
        rangeKey: null,
        startDate: null,
        endDate: null,
        generatedAt: '2026-07-10T08:00:00.000Z',
        summary: 'Summary',
        bullets: [],
        actionLabel: 'Act',
        action: '/go',
        confidenceNote: 'ok',
        aiGenerated: true,
      };

      await service.save(input);

      expect(repo.save).toHaveBeenCalledWith(input);
    });
  });

  describe('listRecentToday', () => {
    it('delegates with default limit of 7', async () => {
      repo.listRecentToday.mockResolvedValue([mockTodayRow]);

      const result = await service.listRecentTodaySummaries('user-1');

      expect(repo.listRecentToday).toHaveBeenCalledWith('user-1', 7);
      expect(result).toEqual([mockTodayRow]);
    });

    it('passes custom limit', async () => {
      repo.listRecentToday.mockResolvedValue([]);

      await service.listRecentTodaySummaries('user-1', 14);

      expect(repo.listRecentToday).toHaveBeenCalledWith('user-1', 14);
    });
  });

  describe('listRecentReports', () => {
    it('delegates with default limit of 6', async () => {
      repo.listRecentReports.mockResolvedValue([mockReportRow]);

      const result = await service.listRecentReportSummaries('user-1');

      expect(repo.listRecentReports).toHaveBeenCalledWith('user-1', 6);
      expect(result).toEqual([mockReportRow]);
    });

    it('passes custom limit', async () => {
      repo.listRecentReports.mockResolvedValue([]);

      await service.listRecentReportSummaries('user-1', 12);

      expect(repo.listRecentReports).toHaveBeenCalledWith('user-1', 12);
    });
  });

  describe('getLatestTodaySummaryByDate', () => {
    it('delegates to repository with parsed date', async () => {
      repo.findTodayByDate.mockResolvedValue(mockTodayRow);

      const result = await service.getLatestTodaySummaryByDate(
        'user-1',
        '2026-07-10',
      );

      expect(repo.findTodayByDate).toHaveBeenCalledWith(
        'user-1',
        '2026-07-10',
      );
      expect(result).toEqual(mockTodayRow);
    });

    it('returns null when no summary found', async () => {
      repo.findTodayByDate.mockResolvedValue(null);

      const result = await service.getLatestTodaySummaryByDate(
        'user-1',
        '2026-07-10',
      );

      expect(result).toBeNull();
    });
  });

  describe('getLatestReportSummaryByRange', () => {
    it('delegates with rangeKey input', async () => {
      repo.findReportByRange.mockResolvedValue(mockReportRow);
      const input: ReportRangeQuery = { rangeKey: 'last_7_days' };

      const result = await service.getLatestReportSummaryByRange(
        'user-1',
        input,
      );

      expect(repo.findReportByRange).toHaveBeenCalledWith(
        'user-1',
        input,
      );
      expect(result).toEqual(mockReportRow);
    });

    it('delegates with startDate/endDate input', async () => {
      repo.findReportByRange.mockResolvedValue(null);
      const input: ReportRangeQuery = {
        startDate: '2026-07-01',
        endDate: '2026-07-10',
      };

      const result = await service.getLatestReportSummaryByRange(
        'user-1',
        input,
      );

      expect(repo.findReportByRange).toHaveBeenCalledWith(
        'user-1',
        input,
      );
      expect(result).toBeNull();
    });
  });
});
