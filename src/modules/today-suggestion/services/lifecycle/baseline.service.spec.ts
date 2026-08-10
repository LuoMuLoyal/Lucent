import type { DeepMocked } from '../../../../common/types/deep-mocked';
import type { PrismaService } from '../../../../prisma';
import type { Prisma } from '#generated/prisma/client';
import { BaselineService } from './baseline.service';
import { BaselineDimension } from '../../types/baseline.types';
import { TriggerType } from '../../types/suggestion.types';

describe('BaselineService', () => {
  let service: BaselineService;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn(),
      userSuggestionBaseline: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        upsert: vi.fn(),
      },
      userSuggestionBaselineObservation: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as DeepMocked<PrismaService>;
    (prisma.$transaction as vi.Mock).mockImplementation(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(prisma as unknown as Prisma.TransactionClient),
    );
    service = new BaselineService(prisma);
  });

  describe('getBaseline', () => {
    it('returns null when no baseline record exists', async () => {
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue(
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
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue({
        userId: 'user-1',
        dimension: BaselineDimension.WATER_INTAKE,
        daysCollected: 5,
        baselineValue: 6,
        establishedAt,
      });

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
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue({
        establishedAt: new Date('2026-07-07'),
      });

      const result = await service.isBaselineReady(
        'user-1',
        BaselineDimension.SLEEP_DURATION,
      );

      expect(result).toBe(true);
    });

    it('returns false when establishedAt is null', async () => {
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue({
        establishedAt: null,
      });

      const result = await service.isBaselineReady(
        'user-1',
        BaselineDimension.SLEEP_DURATION,
      );

      expect(result).toBe(false);
    });

    it('returns false when no baseline record exists', async () => {
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue(
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
      (prisma.userSuggestionBaseline.findMany as vi.Mock).mockResolvedValue([]);

      const status = await service.getBaselineStatus('user-1');

      for (const dim of Object.values(BaselineDimension)) {
        expect(status.get(dim)).toBe(false);
      }
    });

    it('marks dimensions as ready when establishedAt is set', async () => {
      (prisma.userSuggestionBaseline.findMany as vi.Mock).mockResolvedValue([
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
    it('does not persist a non-finite value', async () => {
      await service.recordObservation(
        'user-1',
        BaselineDimension.WATER_INTAKE,
        Number.NaN,
        '2026-07-09',
      );

      expect(
        prisma.userSuggestionBaselineObservation.createMany,
      ).not.toHaveBeenCalled();
      expect(prisma.userSuggestionBaseline.create).not.toHaveBeenCalled();
    });

    it.each(['2026-02-30', '2026-13-01', '2026-00-01'])(
      'does not persist an invalid calendar date: %s',
      async (date) => {
        await service.recordObservation(
          'user-1',
          BaselineDimension.WATER_INTAKE,
          1,
          date,
        );

        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('counts consecutive observations for dimensions without a daily-record kind', async () => {
      (
        prisma.userSuggestionBaselineObservation.findMany as vi.Mock
      ).mockResolvedValue([
        { localDate: new Date('2026-07-09T00:00:00.000Z') },
        { localDate: new Date('2026-07-08T00:00:00.000Z') },
        { localDate: new Date('2026-07-07T00:00:00.000Z') },
      ]);
      await service.recordObservation(
        'user-1',
        BaselineDimension.CAFFEINE_INTAKE,
        2,
        '2026-07-09',
      );

      expect(prisma.userSuggestionBaseline.upsert).toHaveBeenCalledWith({
        where: {
          userId_dimension: {
            userId: 'user-1',
            dimension: BaselineDimension.CAFFEINE_INTAKE,
          },
        },
        create: {
          userId: 'user-1',
          dimension: BaselineDimension.CAFFEINE_INTAKE,
          daysCollected: 3,
          baselineValue: 2,
          establishedAt: expect.any(Date),
        },
        update: { daysCollected: { increment: 0 } },
      });
    });

    it('records an explicit zero and skips missing, non-finite, or insufficient signals', async () => {
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue(
        null,
      );
      (prisma.userSuggestionBaseline.create as vi.Mock).mockResolvedValue({});

      await service.recordObservations('user-1', '2026-07-09', [
        {
          signalId: 'explicit-zero',
          source: 'record',
          kind: 'water_count',
          recordedAt: new Date('2026-07-09T00:00:00.000Z'),
          payload: {
            observedValue: 0,
            coverage: { sufficient: true },
          },
          userId: 'user-1',
          triggerType: TriggerType.TIMER,
        },
        {
          signalId: 'missing-value',
          source: 'record',
          kind: 'water_count',
          recordedAt: new Date('2026-07-09T00:00:00.000Z'),
          payload: { coverage: { sufficient: true } },
          userId: 'user-1',
          triggerType: TriggerType.TIMER,
        },
        {
          signalId: 'non-finite',
          source: 'record',
          kind: 'water_count',
          recordedAt: new Date('2026-07-09T00:00:00.000Z'),
          payload: {
            observedValue: Number.NaN,
            coverage: { sufficient: true },
          },
          userId: 'user-1',
          triggerType: TriggerType.TIMER,
        },
        {
          signalId: 'insufficient',
          source: 'record',
          kind: 'water_count',
          recordedAt: new Date('2026-07-09T00:00:00.000Z'),
          payload: {
            observedValue: 4,
            coverage: { sufficient: false },
          },
          userId: 'user-1',
          triggerType: TriggerType.TIMER,
        },
      ]);

      expect(
        prisma.userSuggestionBaselineObservation.createMany,
      ).toHaveBeenCalledTimes(1);
      expect(
        prisma.userSuggestionBaselineObservation.createMany,
      ).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          dimension: BaselineDimension.WATER_INTAKE,
          localDate: new Date('2026-07-09T00:00:00.000Z'),
          value: 0,
        },
        skipDuplicates: true,
      });
    });

    it('stores one observation per user, dimension, and local date before updating the baseline', async () => {
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue(
        null,
      );
      (prisma.userSuggestionBaseline.create as vi.Mock).mockResolvedValue({});

      await service.recordObservation(
        'user-1',
        BaselineDimension.WATER_INTAKE,
        6,
        '2026-07-09',
      );

      expect(
        prisma.userSuggestionBaselineObservation.createMany,
      ).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          dimension: BaselineDimension.WATER_INTAKE,
          localDate: new Date('2026-07-09T00:00:00.000Z'),
          value: 6,
        },
        skipDuplicates: true,
      });
    });

    it('reconciles the aggregate baseline when the date observation already exists', async () => {
      (
        prisma.userSuggestionBaselineObservation.createMany as vi.Mock
      ).mockResolvedValue({
        count: 0,
      });
      await service.recordObservation(
        'user-1',
        BaselineDimension.WATER_INTAKE,
        6,
        '2026-07-09',
      );

      expect(prisma.userSuggestionBaseline.upsert).toHaveBeenCalled();
      expect(prisma.userSuggestionBaseline.updateMany).toHaveBeenCalled();
    });

    it('creates a new baseline record when one observation day is present', async () => {
      (
        prisma.userSuggestionBaselineObservation.findMany as vi.Mock
      ).mockResolvedValue([
        { localDate: new Date('2026-07-09T00:00:00.000Z') },
      ]);
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue(
        null,
      );
      (prisma.userSuggestionBaseline.create as vi.Mock).mockResolvedValue({});

      await service.recordObservation(
        'user-1',
        BaselineDimension.WATER_INTAKE,
        6,
        '2026-07-09',
      );

      expect(prisma.userSuggestionBaseline.upsert).toHaveBeenCalledWith({
        where: {
          userId_dimension: {
            userId: 'user-1',
            dimension: BaselineDimension.WATER_INTAKE,
          },
        },
        create: {
          userId: 'user-1',
          dimension: BaselineDimension.WATER_INTAKE,
          daysCollected: 1,
          baselineValue: null,
          establishedAt: null,
        },
        update: { daysCollected: { increment: 0 } },
      });
    });

    it('creates a new baseline record with establishedAt after three observation days', async () => {
      (
        prisma.userSuggestionBaselineObservation.findMany as vi.Mock
      ).mockResolvedValue([
        { localDate: new Date('2026-07-09T00:00:00.000Z') },
        { localDate: new Date('2026-07-08T00:00:00.000Z') },
        { localDate: new Date('2026-07-07T00:00:00.000Z') },
      ]);
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue(
        null,
      );
      (prisma.userSuggestionBaseline.create as vi.Mock).mockResolvedValue({});

      await service.recordObservation(
        'user-1',
        BaselineDimension.WATER_INTAKE,
        7,
        '2026-07-09',
      );

      expect(prisma.userSuggestionBaseline.upsert).toHaveBeenCalledWith({
        where: {
          userId_dimension: {
            userId: 'user-1',
            dimension: BaselineDimension.WATER_INTAKE,
          },
        },
        create: {
          userId: 'user-1',
          dimension: BaselineDimension.WATER_INTAKE,
          daysCollected: 3,
          baselineValue: 7,
          establishedAt: expect.any(Date),
        },
        update: { daysCollected: { increment: 0 } },
      });
    });

    it('updates existing baseline record when it exists', async () => {
      (
        prisma.userSuggestionBaselineObservation.findMany as vi.Mock
      ).mockResolvedValue([
        { localDate: new Date('2026-07-09T00:00:00.000Z') },
      ]);
      await service.recordObservation(
        'user-1',
        BaselineDimension.WATER_INTAKE,
        6,
        '2026-07-09',
      );

      expect(prisma.userSuggestionBaseline.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          dimension: BaselineDimension.WATER_INTAKE,
          daysCollected: { lt: 1 },
        },
        data: { daysCollected: 1 },
      });
    });

    it('does not establish with fewer than three observation days', async () => {
      (
        prisma.userSuggestionBaselineObservation.findMany as vi.Mock
      ).mockResolvedValue([
        { localDate: new Date('2026-07-09T00:00:00.000Z') },
      ]);
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue(
        null,
      );
      (prisma.userSuggestionBaseline.create as vi.Mock).mockResolvedValue({});

      await service.recordObservation(
        'user-1',
        BaselineDimension.CAFFEINE_INTAKE,
        2,
        '2026-07-09',
      );

      expect(prisma.userSuggestionBaseline.upsert).toHaveBeenCalledWith({
        where: {
          userId_dimension: {
            userId: 'user-1',
            dimension: BaselineDimension.CAFFEINE_INTAKE,
          },
        },
        create: {
          userId: 'user-1',
          dimension: BaselineDimension.CAFFEINE_INTAKE,
          daysCollected: 1,
          baselineValue: null,
          establishedAt: null,
        },
        update: { daysCollected: { increment: 0 } },
      });
    });

    it('counts consecutive days backwards from the target date', async () => {
      // Days: 7/9, 7/8, 7/7 present, 7/6 missing → 3 consecutive
      (
        prisma.userSuggestionBaselineObservation.findMany as vi.Mock
      ).mockResolvedValue([
        { localDate: new Date('2026-07-09T00:00:00.000Z') },
        { localDate: new Date('2026-07-08T00:00:00.000Z') },
        { localDate: new Date('2026-07-07T00:00:00.000Z') },
        // 7/6 missing — gap
        { localDate: new Date('2026-07-05T00:00:00.000Z') },
      ]);
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue(
        null,
      );
      (prisma.userSuggestionBaseline.create as vi.Mock).mockResolvedValue({});

      await service.recordObservation(
        'user-1',
        BaselineDimension.SLEEP_DURATION,
        400,
        '2026-07-09',
      );

      const createCall = (prisma.userSuggestionBaseline.upsert as vi.Mock).mock
        .calls[0]?.[0];
      expect(createCall.create.daysCollected).toBe(3);
    });

    it('does not establish a baseline before three covered observation days', async () => {
      (prisma.userSuggestionBaseline.findUnique as vi.Mock).mockResolvedValue(
        null,
      );
      (prisma.userSuggestionBaseline.create as vi.Mock).mockResolvedValue({});

      await service.recordObservation(
        'user-1',
        BaselineDimension.WATER_INTAKE,
        7,
        '2026-07-09',
      );

      expect(prisma.userSuggestionBaseline.upsert).toHaveBeenCalledWith({
        where: {
          userId_dimension: {
            userId: 'user-1',
            dimension: BaselineDimension.WATER_INTAKE,
          },
        },
        create: {
          userId: 'user-1',
          dimension: BaselineDimension.WATER_INTAKE,
          daysCollected: 0,
          baselineValue: null,
          establishedAt: null,
        },
        update: { daysCollected: { increment: 0 } },
      });
    });
  });
});
