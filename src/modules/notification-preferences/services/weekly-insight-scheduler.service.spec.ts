import { okAsync } from '../../../common/result';
import { WeeklyInsightSchedulerService } from './weekly-insight-scheduler.service';

const asiaMondayAtNineUtc = new Date('2026-08-17T01:00:00.000Z');
const losAngelesMondayAtNineUtc = new Date('2026-08-17T16:00:00.000Z');

function buildSummary(overrides: Record<string, unknown> = {}) {
  return {
    range: 'last_7_days',
    startDate: '2026-08-10',
    endDate: '2026-08-16',
    generatedAt: '2026-08-17T01:00:00.000Z',
    summary: '近 7 天的饮水记录较稳定。',
    coverage: {
      medication: { trackedDays: 3, totalDays: 7 },
      water: { trackedDays: 4, totalDays: 7 },
      sleep: { trackedDays: 2, totalDays: 7 },
    },
    observedPattern: null,
    lowRiskAction: null,
    disclaimer: '仅供记录回顾。',
    ...overrides,
  };
}

describe('WeeklyInsightSchedulerService', () => {
  it('creates one weekly insight notification for an enabled user with real series', async () => {
    const prisma = {
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'user-1', profile: { timezone: 'Asia/Shanghai' } },
          ]),
      },
    };
    const preferences = {
      get: vi.fn().mockResolvedValue({ weeklyInsightEnabled: true }),
    };
    const reports = {
      generate: vi.fn().mockResolvedValue(buildSummary()),
    };
    const notifications = {
      // createOrReplaceScoped returns ResultAsync after migration; a plain
      // resolved value would throw TypeError on `.match()` and be swallowed
      // by the per-user catch, faking a green test without pushing.
      createOrReplaceScoped: vi.fn().mockReturnValue(okAsync({} as never)),
    };
    const pushDelivery = {
      sendToUser: vi.fn().mockResolvedValue({ sent: true }),
    };
    const service = new WeeklyInsightSchedulerService(
      prisma as never,
      preferences as never,
      reports as never,
      notifications as never,
      pushDelivery as never,
      { t: vi.fn().mockReturnValue('Weekly health insight') } as never,
    );

    await service.runTick(asiaMondayAtNineUtc);

    expect(reports.generate).toHaveBeenCalledWith(
      'user-1',
      {
        range: 'custom',
        startDate: '2026-08-10',
        endDate: '2026-08-16',
      },
      expect.any(String),
    );
    expect(notifications.createOrReplaceScoped).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'ai_weekly_insight' }),
      expect.objectContaining({ date: '2026-08-10' }),
    );
    expect(pushDelivery.sendToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        body: '近 7 天的饮水记录较稳定。',
        data: expect.objectContaining({ action: 'ai_weekly_insight' }),
      }),
    );
  });

  it('does not notify when the summary has no real series', async () => {
    const prisma = {
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'user-1', profile: { timezone: 'Asia/Shanghai' } },
          ]),
      },
    };
    const preferences = {
      get: vi.fn().mockResolvedValue({ weeklyInsightEnabled: true }),
    };
    const reports = {
      generate: vi.fn().mockResolvedValue(
        buildSummary({
          coverage: {
            medication: { trackedDays: 0, totalDays: 7 },
            water: { trackedDays: 0, totalDays: 7 },
            sleep: { trackedDays: 0, totalDays: 7 },
          },
        }),
      ),
    };
    const notifications = { createOrReplaceScoped: vi.fn() };
    const service = new WeeklyInsightSchedulerService(
      prisma as never,
      preferences as never,
      reports as never,
      notifications as never,
      { sendToUser: vi.fn().mockResolvedValue({ sent: true }) } as never,
      { t: vi.fn().mockReturnValue('Weekly health insight') } as never,
    );

    await service.runTick(asiaMondayAtNineUtc);

    expect(notifications.createOrReplaceScoped).not.toHaveBeenCalled();
  });

  it('does not generate a summary when weekly insights are disabled', async () => {
    const prisma = {
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'user-1', profile: { timezone: 'Asia/Shanghai' } },
          ]),
      },
    };
    const preferences = {
      get: vi.fn().mockResolvedValue({ weeklyInsightEnabled: false }),
    };
    const reports = { generate: vi.fn() };
    const notifications = { createOrReplaceScoped: vi.fn() };
    const service = new WeeklyInsightSchedulerService(
      prisma as never,
      preferences as never,
      reports as never,
      notifications as never,
      { sendToUser: vi.fn().mockResolvedValue({ sent: true }) } as never,
      { t: vi.fn().mockReturnValue('Weekly health insight') } as never,
    );

    await service.runTick(asiaMondayAtNineUtc);

    expect(reports.generate).not.toHaveBeenCalled();
  });

  it('uses the previous complete local week for America/Los_Angeles', async () => {
    const prisma = {
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'user-1', profile: { timezone: 'America/Los_Angeles' } },
          ]),
      },
    };
    const preferences = {
      get: vi.fn().mockResolvedValue({ weeklyInsightEnabled: true }),
    };
    const reports = {
      generate: vi.fn().mockResolvedValue(buildSummary()),
    };
    const notifications = {
      createOrReplaceScoped: vi.fn().mockReturnValue(okAsync({} as never)),
    };
    const pushDelivery = {
      sendToUser: vi.fn().mockResolvedValue({ sent: true }),
    };
    const service = new WeeklyInsightSchedulerService(
      prisma as never,
      preferences as never,
      reports as never,
      notifications as never,
      pushDelivery as never,
      { t: vi.fn().mockReturnValue('Weekly health insight') } as never,
    );

    await service.runTick(losAngelesMondayAtNineUtc);

    expect(reports.generate).toHaveBeenCalledWith(
      'user-1',
      {
        range: 'custom',
        startDate: '2026-08-10',
        endDate: '2026-08-16',
      },
      expect.any(String),
    );
    expect(notifications.createOrReplaceScoped).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      expect.objectContaining({ date: '2026-08-10' }),
    );
    expect(pushDelivery.sendToUser).toHaveBeenCalledTimes(1);
  });
});
