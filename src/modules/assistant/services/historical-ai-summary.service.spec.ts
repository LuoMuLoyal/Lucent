import type {
  AssistantSummaryRepositoryPort,
  PersistSummaryInput,
  TodaySummaryRow,
  ReportSummaryRow,
  ReportRangeInput,
} from '../repositories/summary.repository';

import { HistoricalAiSummaryService } from './historical-ai-summary.service';

describe('HistoricalAiSummaryService', () => {
  let service: HistoricalAiSummaryService;
  let repo: jest.Mocked<AssistantSummaryRepositoryPort>;

  const mockTodayRow: TodaySummaryRow = {
    date: '2026-07-10',
    generatedAt: '2026-07-10T08:00:00.000Z',
    summary: 'Today summary text',
    bullets: [{ kind: 'highlight', text: 'Drank 1L water' }],
    actionLabel: 'Log more water',
    action: '/record/water',
    confidenceNote: 'high confidence',
  };

  const mockReportRow: ReportSummaryRow = {
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
      save: jest.fn().mockResolvedValue(undefined),
      listRecentTodaySummaries: jest.fn(),
      listRecentReportSummaries: jest.fn(),
      findLatestTodaySummaryByDate: jest.fn(),
      findLatestReportSummaryByRange: jest.fn(),
    };
    service = new HistoricalAiSummaryService(repo);
  });

  describe('save', () => {
    it('delegates to repository.save', async () => {
      const input: PersistSummaryInput = {
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
      };

      await service.save(input);

      expect(repo.save).toHaveBeenCalledWith(input);
    });
  });

  describe('listRecentTodaySummaries', () => {
    it('delegates with default limit of 7', async () => {
      repo.listRecentTodaySummaries.mockResolvedValue([mockTodayRow]);

      const result = await service.listRecentTodaySummaries('user-1');

      expect(repo.listRecentTodaySummaries).toHaveBeenCalledWith('user-1', 7);
      expect(result).toEqual([mockTodayRow]);
    });

    it('passes custom limit', async () => {
      repo.listRecentTodaySummaries.mockResolvedValue([]);

      await service.listRecentTodaySummaries('user-1', 14);

      expect(repo.listRecentTodaySummaries).toHaveBeenCalledWith('user-1', 14);
    });
  });

  describe('listRecentReportSummaries', () => {
    it('delegates with default limit of 6', async () => {
      repo.listRecentReportSummaries.mockResolvedValue([mockReportRow]);

      const result = await service.listRecentReportSummaries('user-1');

      expect(repo.listRecentReportSummaries).toHaveBeenCalledWith('user-1', 6);
      expect(result).toEqual([mockReportRow]);
    });

    it('passes custom limit', async () => {
      repo.listRecentReportSummaries.mockResolvedValue([]);

      await service.listRecentReportSummaries('user-1', 12);

      expect(repo.listRecentReportSummaries).toHaveBeenCalledWith('user-1', 12);
    });
  });

  describe('getLatestTodaySummaryByDate', () => {
    it('delegates to repository with parsed date', async () => {
      repo.findLatestTodaySummaryByDate.mockResolvedValue(mockTodayRow);

      const result = await service.getLatestTodaySummaryByDate(
        'user-1',
        '2026-07-10',
      );

      expect(repo.findLatestTodaySummaryByDate).toHaveBeenCalledWith(
        'user-1',
        expect.any(Date),
      );
      expect(result).toEqual(mockTodayRow);
    });

    it('returns null when no summary found', async () => {
      repo.findLatestTodaySummaryByDate.mockResolvedValue(null);

      const result = await service.getLatestTodaySummaryByDate(
        'user-1',
        '2026-07-10',
      );

      expect(result).toBeNull();
    });
  });

  describe('getLatestReportSummaryByRange', () => {
    it('delegates with rangeKey input', async () => {
      repo.findLatestReportSummaryByRange.mockResolvedValue(mockReportRow);
      const input: ReportRangeInput = { rangeKey: 'last_7_days' };

      const result = await service.getLatestReportSummaryByRange(
        'user-1',
        input,
      );

      expect(repo.findLatestReportSummaryByRange).toHaveBeenCalledWith(
        'user-1',
        input,
      );
      expect(result).toEqual(mockReportRow);
    });

    it('delegates with startDate/endDate input', async () => {
      repo.findLatestReportSummaryByRange.mockResolvedValue(null);
      const input: ReportRangeInput = {
        startDate: '2026-07-01',
        endDate: '2026-07-10',
      };

      const result = await service.getLatestReportSummaryByRange(
        'user-1',
        input,
      );

      expect(repo.findLatestReportSummaryByRange).toHaveBeenCalledWith(
        'user-1',
        input,
      );
      expect(result).toBeNull();
    });
  });
});
