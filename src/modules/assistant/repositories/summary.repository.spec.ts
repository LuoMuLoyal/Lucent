import type { DeepMocked } from '../../../common/types/deep-mocked';

import { AiSummaryHistoryKind } from '#generated/prisma/client';
import { AssistantSummaryRepository } from './summary.repository';
import type { PrismaService } from '../../../prisma/prisma.service';

describe('AssistantSummaryRepository', () => {
  let repository: AssistantSummaryRepository;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      assistantSummaryHistory: {
        upsert: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    } as unknown as DeepMocked<PrismaService>;

    repository = new AssistantSummaryRepository(prisma);
  });

  const mockTodayRow = {
    id: 's1',
    userId: 'user-1',
    kind: AiSummaryHistoryKind.today,
    scopeKey: 'today:2026-07-10',
    date: new Date('2026-07-10'),
    rangeKey: null,
    startDate: null,
    endDate: null,
    generatedAt: new Date('2026-07-10T08:00:00.000Z'),
    summary: 'Summary text',
    bullets: [{ kind: 'tracked', text: 'Bullet 1' }],
    actionLabel: 'Review',
    action: 'check',
    confidenceNote: 'high',
  };

  describe('save', () => {
    it('upserts with userId and scopeKey composite key', async () => {
      prisma.assistantSummaryHistory.upsert.mockResolvedValue(
        undefined as never,
      );

      await repository.save({
        userId: 'user-1',
        kind: 'today',
        scopeKey: 'today:2026-07-10',
        date: '2026-07-10',
        rangeKey: null,
        startDate: null,
        endDate: null,
        generatedAt: '2026-07-10T08:00:00.000Z',
        summary: 'Summary',
        bullets: [{ kind: 'tracked', text: 'Bullet' }],
        actionLabel: 'Review',
        action: 'check',
        confidenceNote: 'high',
      });

      expect(prisma.assistantSummaryHistory.upsert).toHaveBeenCalledWith({
        where: {
          userId_scopeKey: { userId: 'user-1', scopeKey: 'today:2026-07-10' },
        },
        create: expect.objectContaining({
          userId: 'user-1',
          kind: AiSummaryHistoryKind.today,
          scopeKey: 'today:2026-07-10',
        }),
        update: expect.objectContaining({
          summary: 'Summary',
        }),
      });
    });

    it('maps report kind to AiSummaryHistoryKind.report', async () => {
      prisma.assistantSummaryHistory.upsert.mockResolvedValue(
        undefined as never,
      );

      await repository.save({
        userId: 'user-1',
        kind: 'report',
        scopeKey: 'report:7d',
        date: null,
        rangeKey: 'last_7_days',
        startDate: '2026-07-04',
        endDate: '2026-07-10',
        generatedAt: '2026-07-10T08:00:00.000Z',
        summary: 'Report summary',
        bullets: [],
        actionLabel: 'OK',
        action: 'none',
        confidenceNote: 'low',
      });

      const call = prisma.assistantSummaryHistory.upsert.mock.calls[0]?.[0];
      expect(call?.create).toHaveProperty('kind', AiSummaryHistoryKind.report);
      expect(call?.create).toHaveProperty('rangeKey', 'last_7_days');
    });
  });

  describe('listRecentTodaySummaries', () => {
    it('queries today summaries with limit', async () => {
      prisma.assistantSummaryHistory.findMany.mockResolvedValue([
        mockTodayRow,
      ] as never);

      const result = await repository.listRecentTodaySummaries('user-1', 10);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        summary: 'Summary text',
        actionLabel: 'Review',
      });
      const call = prisma.assistantSummaryHistory.findMany.mock.calls[0]?.[0];
      expect(call?.where).toEqual({
        userId: 'user-1',
        kind: AiSummaryHistoryKind.today,
      });
      expect(call?.take).toBe(10);
    });

    it('maps date to string via formatDateOnly', async () => {
      prisma.assistantSummaryHistory.findMany.mockResolvedValue([
        mockTodayRow,
      ] as never);

      const result = await repository.listRecentTodaySummaries('user-1', 5);

      expect(result[0]?.date).toBe('2026-07-10');
    });

    it('maps null date to null', async () => {
      prisma.assistantSummaryHistory.findMany.mockResolvedValue([
        { ...mockTodayRow, date: null },
      ] as never);

      const result = await repository.listRecentTodaySummaries('user-1', 5);

      expect(result[0]?.date).toBeNull();
    });

    it('returns empty bullets for non-array raw', async () => {
      prisma.assistantSummaryHistory.findMany.mockResolvedValue([
        { ...mockTodayRow, bullets: 'not an array' },
      ] as never);

      const result = await repository.listRecentTodaySummaries('user-1', 5);

      expect(result[0]?.bullets).toEqual([]);
    });
  });

  describe('listRecentReportSummaries', () => {
    it('queries report summaries with limit', async () => {
      const mockReportRow = {
        ...mockTodayRow,
        kind: AiSummaryHistoryKind.report,
        date: null,
        rangeKey: 'last_7_days',
        startDate: new Date('2026-07-04'),
        endDate: new Date('2026-07-10'),
      };
      prisma.assistantSummaryHistory.findMany.mockResolvedValue([
        mockReportRow,
      ] as never);

      const result = await repository.listRecentReportSummaries('user-1', 5);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        rangeKey: 'last_7_days',
        summary: 'Summary text',
      });
      const call = prisma.assistantSummaryHistory.findMany.mock.calls[0]?.[0];
      expect(call?.where).toEqual({
        userId: 'user-1',
        kind: AiSummaryHistoryKind.report,
      });
    });

    it('maps startDate and endDate to strings', async () => {
      const mockReportRow = {
        ...mockTodayRow,
        kind: AiSummaryHistoryKind.report,
        date: null,
        rangeKey: 'last_7_days',
        startDate: new Date('2026-07-04'),
        endDate: new Date('2026-07-10'),
      };
      prisma.assistantSummaryHistory.findMany.mockResolvedValue([
        mockReportRow,
      ] as never);

      const result = await repository.listRecentReportSummaries('user-1', 5);

      expect(result[0]?.startDate).toBe('2026-07-04');
      expect(result[0]?.endDate).toBe('2026-07-10');
    });
  });

  describe('findLatestTodaySummaryByDate', () => {
    it('queries by userId, kind, and date', async () => {
      prisma.assistantSummaryHistory.findFirst.mockResolvedValue(
        mockTodayRow as never,
      );

      const result = await repository.findLatestTodaySummaryByDate(
        'user-1',
        new Date('2026-07-10'),
      );

      expect(result).not.toBeNull();
      const call = prisma.assistantSummaryHistory.findFirst.mock.calls[0]?.[0];
      expect(call?.where).toEqual({
        userId: 'user-1',
        kind: AiSummaryHistoryKind.today,
        date: new Date('2026-07-10'),
      });
    });

    it('returns null when not found', async () => {
      prisma.assistantSummaryHistory.findFirst.mockResolvedValue(null);
      expect(
        await repository.findLatestTodaySummaryByDate('user-1', new Date()),
      ).toBeNull();
    });
  });

  describe('findLatestReportSummaryByRange', () => {
    it('queries with rangeKey when provided', async () => {
      const mockReportRow = {
        ...mockTodayRow,
        kind: AiSummaryHistoryKind.report,
        date: null,
        rangeKey: 'last_7_days',
        startDate: null,
        endDate: null,
      };
      prisma.assistantSummaryHistory.findFirst.mockResolvedValue(
        mockReportRow as never,
      );

      const result = await repository.findLatestReportSummaryByRange('user-1', {
        rangeKey: 'last_7_days',
      });

      expect(result).not.toBeNull();
      const call = prisma.assistantSummaryHistory.findFirst.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({
        userId: 'user-1',
        kind: AiSummaryHistoryKind.report,
        rangeKey: 'last_7_days',
      });
    });

    it('queries with startDate and endDate when provided', async () => {
      prisma.assistantSummaryHistory.findFirst.mockResolvedValue(null);

      await repository.findLatestReportSummaryByRange('user-1', {
        startDate: '2026-07-04',
        endDate: '2026-07-10',
      });

      const call = prisma.assistantSummaryHistory.findFirst.mock.calls[0]?.[0];
      expect(call?.where).toHaveProperty('startDate');
      expect(call?.where).toHaveProperty('endDate');
    });

    it('returns null when not found', async () => {
      prisma.assistantSummaryHistory.findFirst.mockResolvedValue(null);
      expect(
        await repository.findLatestReportSummaryByRange('user-1', {}),
      ).toBeNull();
    });
  });
});
