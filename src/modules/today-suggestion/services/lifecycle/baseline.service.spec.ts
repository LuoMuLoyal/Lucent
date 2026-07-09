import type { PrismaService } from '../../../../prisma/prisma.service';
import { BaselineService } from './baseline.service';
import { BaselineDimension } from '../../types';

describe('BaselineService', () => {
  let service: BaselineService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      userSuggestionBaseline: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      userDailyRecord: { findMany: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    service = new BaselineService(prisma);
  });

  describe('getBaseline', () => {
    it('returns null when no baseline record exists', async () => {
      (prisma.userSuggestionBaseline.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.getBaseline(
        'user-1',
        BaselineDimension.WATER_INTAKE,
      );

      expect(result).toBeNull();
    });

    it('returns the stored baseline record', async () => {
      const establishedAt = new Date('2026-07-07');
      (prisma.userSuggestionBaseline.findUnique as jest.Mock).mockResolvedValue(
        {
          userId: 'user-1',
          dimension: BaselineDimension.WATER_INTAKE,
          daysCollected: 5,
          baselineValue: 6,
          establishedAt,
        },
      );

      const result = await service.getBaseline(
        'user-1',
        BaselineDimension.WATER_INTAKE,
      );

      expect(result).toEqual({
        userId: 'user-1',
        dimension: BaselineDimension.WATER_INTAKE,
        daysCollected: 5,
        baselineValue: 6,
        establishedAt,
      });
    });
  });

  describe('isBaselineReady', () => {
    it('returns true when establishedAt is set', async () => {
      (prisma.userSuggestionBaseline.findUnique as jest.Mock).mockResolvedValue(
        {
          establishedAt: new Date('2026-07-07'),
        },
      );

      const result = await service.isBaselineReady(
        'user-1',
        BaselineDimension.SLEEP_DURATION,
      );

      expect(result).toBe(true);
    });

    it('returns false when establishedAt is null', async () => {
      (prisma.userSuggestionBaseline.findUnique as jest.Mock).mockResolvedValue(
        {
          establishedAt: null,
        },
      );

      const result = await service.isBaselineReady(
        'user-1',
        BaselineDimension.SLEEP_DURATION,
      );

      expect(result).toBe(false);
    });

    it('returns false when no baseline record exists', async () => {
      (prisma.userSuggestionBaseline.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.isBaselineReady(
        'user-1',
        BaselineDimension.MOOD,
      );

      expect(result).toBe(false);
    });
  });

  describe('getBaselineStatus', () => {
    it('returns a map with all dimensions set to false when no records exist', async () => {
      (prisma.userSuggestionBaseline.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      const status = await service.getBaselineStatus('user-1');

      for (const dim of Object.values(BaselineDimension)) {
        expect(status.get(dim)).toBe(false);
      }
    });

    it('marks dimensions as ready when establishedAt is set', async () => {
      (prisma.userSuggestionBaseline.findMany as jest.Mock).mockResolvedValue([
        {
          dimension: BaselineDimension.WATER_INTAKE,
          establishedAt: new Date('2026-07-07'),
        },
        { dimension: BaselineDimension.MOOD, establishedAt: null },
      ]);

      const status = await service.getBaselineStatus('user-1');

      expect(status.get(BaselineDimension.WATER_INTAKE)).toBe(true);
      expect(status.get(BaselineDimension.MOOD)).toBe(false);
      expect(status.get(BaselineDimension.SLEEP_DURATION)).toBe(false);
    });
  });

  describe('recordObservation', () => {
    it('creates a new baseline record when none exists and baseline is not yet established', async () => {
      // countConsecutiveDays: 1 day (< BASELINE_MIN_DAYS)
      (prisma.userDailyRecord.findMany as jest.Mock).mockResolvedValue([
        { occurredAt: new Date('2026-07-09T00:00:00.000Z') },
      ]);
      (prisma.userSuggestionBaseline.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.userSuggestionBaseline.create as jest.Mock).mockResolvedValue({});

      await service.recordObservation(
        'user-1',
        BaselineDimension.WATER_INTAKE,
        6,
        '2026-07-09',
      );

      expect(prisma.userSuggestionBaseline.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          dimension: BaselineDimension.WATER_INTAKE,
          daysCollected: 1,
          baselineValue: null,
          establishedAt: null,
        },
      });
    });

    it('creates a new baseline record with establishedAt when consecutive days >= min', async () => {
      // 3 consecutive days (>= BASELINE_MIN_DAYS)
      (prisma.userDailyRecord.findMany as jest.Mock).mockResolvedValue([
        { occurredAt: new Date('2026-07-09T00:00:00.000Z') },
        { occurredAt: new Date('2026-07-08T00:00:00.000Z') },
        { occurredAt: new Date('2026-07-07T00:00:00.000Z') },
      ]);
      (prisma.userSuggestionBaseline.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.userSuggestionBaseline.create as jest.Mock).mockResolvedValue({});

      await service.recordObservation(
        'user-1',
        BaselineDimension.WATER_INTAKE,
        7,
        '2026-07-09',
      );

      expect(prisma.userSuggestionBaseline.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          dimension: BaselineDimension.WATER_INTAKE,
          daysCollected: 3,
          baselineValue: 7,
          establishedAt: expect.any(Date),
        },
      });
    });

    it('updates existing baseline record when it exists', async () => {
      (prisma.userDailyRecord.findMany as jest.Mock).mockResolvedValue([
        { occurredAt: new Date('2026-07-09T00:00:00.000Z') },
      ]);
      const existingEstablishedAt = new Date('2026-07-05');
      (prisma.userSuggestionBaseline.findUnique as jest.Mock).mockResolvedValue(
        {
          establishedAt: existingEstablishedAt,
          baselineValue: 5,
        },
      );
      (prisma.userSuggestionBaseline.update as jest.Mock).mockResolvedValue({});

      await service.recordObservation(
        'user-1',
        BaselineDimension.WATER_INTAKE,
        6,
        '2026-07-09',
      );

      expect(prisma.userSuggestionBaseline.update).toHaveBeenCalledWith({
        where: {
          userId_dimension: {
            userId: 'user-1',
            dimension: BaselineDimension.WATER_INTAKE,
          },
        },
        data: {
          daysCollected: 1,
          baselineValue: 5, // keeps existing when not established yet
          establishedAt: existingEstablishedAt,
        },
      });
    });

    it('returns 0 consecutive days for dimensions without a record kind mapping', async () => {
      (prisma.userDailyRecord.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.userSuggestionBaseline.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.userSuggestionBaseline.create as jest.Mock).mockResolvedValue({});

      await service.recordObservation(
        'user-1',
        BaselineDimension.CAFFEINE_INTAKE,
        2,
        '2026-07-09',
      );

      expect(prisma.userSuggestionBaseline.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          dimension: BaselineDimension.CAFFEINE_INTAKE,
          daysCollected: 0,
          baselineValue: null,
          establishedAt: null,
        },
      });
    });

    it('counts consecutive days backwards from the target date', async () => {
      // Days: 7/9, 7/8, 7/7 present, 7/6 missing → 3 consecutive
      (prisma.userDailyRecord.findMany as jest.Mock).mockResolvedValue([
        { occurredAt: new Date('2026-07-09T00:00:00.000Z') },
        { occurredAt: new Date('2026-07-08T00:00:00.000Z') },
        { occurredAt: new Date('2026-07-07T00:00:00.000Z') },
        // 7/6 missing — gap
        { occurredAt: new Date('2026-07-05T00:00:00.000Z') },
      ]);
      (prisma.userSuggestionBaseline.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.userSuggestionBaseline.create as jest.Mock).mockResolvedValue({});

      await service.recordObservation(
        'user-1',
        BaselineDimension.SLEEP_DURATION,
        400,
        '2026-07-09',
      );

      const createCall = (prisma.userSuggestionBaseline.create as jest.Mock)
        .mock.calls[0]?.[0];
      expect(createCall.data.daysCollected).toBe(3);
    });
  });
});
