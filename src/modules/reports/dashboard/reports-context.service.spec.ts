import { REPORT_RANGE_LAST_7_DAYS } from '../dto';
import { ReportsContextService } from './reports-context.service';

describe('ReportsContextService', () => {
  it('defaults ai summary to enabled when the user setting is missing', async () => {
    const prisma = {
      userSetting: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      userMedicineDoseLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      userDailyRecord: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

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
    const prisma = {
      userSetting: {
        findFirst: jest.fn().mockResolvedValue({ value: false }),
      },
      userMedicineDoseLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      userDailyRecord: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const service = new ReportsContextService(prisma as never);

    const context = await service.build('u1', {
      range: REPORT_RANGE_LAST_7_DAYS,
    });

    expect(context.aiSummaryEnabled).toBe(false);
  });
});
