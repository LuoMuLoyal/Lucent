import { BadRequestException } from '@nestjs/common';
import {
  REPORT_RANGE_CUSTOM,
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
} from '../dto';
import { ReportsContextService } from './context.service';

describe('ReportsContextService', () => {
  const buildMocks = () => ({
    prisma: {
      userSetting: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    dailyRecordReader: {
      listFactsInRange: vi.fn().mockResolvedValue([]),
    },
    doseLogReader: {
      listFactsInRange: vi.fn().mockResolvedValue([]),
    },
  });

  it('defaults ai summary to enabled when the user setting is missing', async () => {
    const { prisma, dailyRecordReader, doseLogReader } = buildMocks();
    const service = new ReportsContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
    );

    const context = await service.build('u1', {
      range: REPORT_RANGE_LAST_7_DAYS,
    });

    expect(context.aiSummaryEnabled).toBe(true);
    expect(prisma.userSetting.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', key: 'aiSummariesEnabled' },
      select: { value: true },
    });
  });

  it('keeps ai summary disabled when the user setting is explicitly false', async () => {
    const { prisma, dailyRecordReader, doseLogReader } = buildMocks();
    prisma.userSetting.findFirst = vi.fn().mockResolvedValue({ value: false });
    const service = new ReportsContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
    );

    const context = await service.build('u1', {
      range: REPORT_RANGE_LAST_7_DAYS,
    });

    expect(context.aiSummaryEnabled).toBe(false);
  });

  it('resolves last_30_days start date', async () => {
    const { prisma, dailyRecordReader, doseLogReader } = buildMocks();
    const service = new ReportsContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
    );

    const context = await service.build('u1', {
      range: REPORT_RANGE_LAST_30_DAYS,
    });

    expect(context.range).toBe(REPORT_RANGE_LAST_30_DAYS);
    const days =
      (context.endDate.getTime() - context.startDate.getTime()) /
      (1000 * 60 * 60 * 24);
    expect(days).toBe(29);
  });

  it('resolves custom range from query dates', async () => {
    const { prisma, dailyRecordReader, doseLogReader } = buildMocks();
    const service = new ReportsContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
    );

    const context = await service.build('u1', {
      range: REPORT_RANGE_CUSTOM,
      startDate: '2026-06-01',
      endDate: '2026-06-10',
    });

    expect(context.range).toBe(REPORT_RANGE_CUSTOM);
    expect(context.startDate.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(context.endDate.toISOString()).toBe('2026-06-10T00:00:00.000Z');
  });

  it('throws when custom range is missing startDate', async () => {
    const { prisma, dailyRecordReader, doseLogReader } = buildMocks();
    const service = new ReportsContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
    );

    await expect(
      service.build('u1', {
        range: REPORT_RANGE_CUSTOM,
        endDate: '2026-06-10',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when custom range is missing endDate', async () => {
    const { prisma, dailyRecordReader, doseLogReader } = buildMocks();
    const service = new ReportsContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
    );

    await expect(
      service.build('u1', {
        range: REPORT_RANGE_CUSTOM,
        startDate: '2026-06-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when custom startDate is after endDate', async () => {
    const { prisma, dailyRecordReader, doseLogReader } = buildMocks();
    const service = new ReportsContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
    );

    await expect(
      service.build('u1', {
        range: REPORT_RANGE_CUSTOM,
        startDate: '2026-06-10',
        endDate: '2026-06-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts meal estimate days only from confirmed and unconfirmed meal analyses', async () => {
    const { prisma, dailyRecordReader, doseLogReader } = buildMocks();
    dailyRecordReader.listFactsInRange = vi.fn().mockResolvedValue([
      {
        occurredAt: new Date('2026-06-06T00:00:00.000Z'),
        kind: 'meal',
        value: null,
        unit: null,
        payload: {
          mealAnalysis: {
            analysisStatus: 'confirmed',
            coverage: 'complete',
          },
        },
      },
      {
        occurredAt: new Date('2026-06-07T00:00:00.000Z'),
        kind: 'meal',
        value: null,
        unit: null,
        payload: {
          mealAnalysis: {
            analysisStatus: 'unconfirmed',
            coverage: 'partial',
          },
        },
      },
      {
        occurredAt: new Date('2026-06-08T00:00:00.000Z'),
        kind: 'meal',
        value: null,
        unit: null,
        payload: {
          mealAnalysis: {
            analysisStatus: 'analysis_failed',
            coverage: 'none',
          },
        },
      },
      {
        occurredAt: new Date('2026-06-09T00:00:00.000Z'),
        kind: 'water',
        value: '500',
        unit: 'ml',
        payload: null,
      },
    ]);
    const service = new ReportsContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
    );

    const context = await service.build('u1', {
      range: REPORT_RANGE_CUSTOM,
      startDate: '2026-06-06',
      endDate: '2026-06-12',
    });

    expect(context.mealEstimateSeries).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(context.mealEstimateTrackedDays).toBe(2);
    expect(context.mealEstimateBreakdown).toEqual({
      confirmedDays: 1,
      estimatedDays: 1,
      partialDays: 1,
      analyzingDays: 0,
      failedDays: 1,
    });
  });

  it('breaks down meal estimate status per day for the AI summary', async () => {
    const { prisma, dailyRecordReader, doseLogReader } = buildMocks();
    dailyRecordReader.listFactsInRange = vi.fn().mockResolvedValue([
      {
        occurredAt: new Date('2026-06-06T00:00:00.000Z'),
        kind: 'meal',
        value: null,
        unit: null,
        payload: {
          mealAnalysis: {
            analysisStatus: 'analyzing',
            coverage: 'none',
          },
        },
      },
      {
        occurredAt: new Date('2026-06-07T00:00:00.000Z'),
        kind: 'meal',
        value: null,
        unit: null,
        payload: {
          mealAnalysis: {
            analysisStatus: 'unconfirmed',
            coverage: 'complete',
          },
        },
      },
      {
        occurredAt: new Date('2026-06-08T00:00:00.000Z'),
        kind: 'meal',
        value: null,
        unit: null,
        payload: {
          mealAnalysis: {
            analysisStatus: 'confirmed',
            coverage: 'partial',
          },
        },
      },
    ]);
    const service = new ReportsContextService(
      prisma as never,
      dailyRecordReader as never,
      doseLogReader as never,
    );

    const context = await service.build('u1', {
      range: REPORT_RANGE_CUSTOM,
      startDate: '2026-06-06',
      endDate: '2026-06-12',
    });

    expect(context.mealEstimateBreakdown).toEqual({
      confirmedDays: 1,
      estimatedDays: 1,
      partialDays: 1,
      analyzingDays: 1,
      failedDays: 0,
    });
  });
});
