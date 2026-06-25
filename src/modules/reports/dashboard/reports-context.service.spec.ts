import { BadRequestException } from '@nestjs/common';
import {
  REPORT_RANGE_CUSTOM,
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
} from '../dto';
import { ReportsContextService } from './reports-context.service';

describe('ReportsContextService', () => {
  const buildPrisma = () => ({
    userSetting: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    userMedicineDoseLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    userDailyRecord: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  });

  it('defaults ai summary to enabled when the user setting is missing', async () => {
    const prisma = buildPrisma();
    const service = new ReportsContextService(prisma as never);

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
    const prisma = buildPrisma();
    prisma.userSetting.findFirst = jest
      .fn()
      .mockResolvedValue({ value: false });
    const service = new ReportsContextService(prisma as never);

    const context = await service.build('u1', {
      range: REPORT_RANGE_LAST_7_DAYS,
    });

    expect(context.aiSummaryEnabled).toBe(false);
  });

  it('resolves last_30_days start date', async () => {
    const prisma = buildPrisma();
    const service = new ReportsContextService(prisma as never);

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
    const prisma = buildPrisma();
    const service = new ReportsContextService(prisma as never);

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
    const prisma = buildPrisma();
    const service = new ReportsContextService(prisma as never);

    await expect(
      service.build('u1', {
        range: REPORT_RANGE_CUSTOM,
        endDate: '2026-06-10',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when custom range is missing endDate', async () => {
    const prisma = buildPrisma();
    const service = new ReportsContextService(prisma as never);

    await expect(
      service.build('u1', {
        range: REPORT_RANGE_CUSTOM,
        startDate: '2026-06-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when custom startDate is after endDate', async () => {
    const prisma = buildPrisma();
    const service = new ReportsContextService(prisma as never);

    await expect(
      service.build('u1', {
        range: REPORT_RANGE_CUSTOM,
        startDate: '2026-06-10',
        endDate: '2026-06-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
