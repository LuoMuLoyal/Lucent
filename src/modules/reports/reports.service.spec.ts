import { ReportsService } from './reports.service';
import { REPORT_RANGE_LAST_7_DAYS } from './dto';

describe('ReportsService', () => {
  it('builds a dashboard with real medication and water aggregates', async () => {
    const service = new ReportsService({
      userSetting: {
        findFirst: jest.fn().mockResolvedValue({ value: true }),
      },
      userMedicineDoseLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            scheduledFor: new Date('2026-06-06T00:00:00.000Z'),
            status: 'taken',
          },
          {
            scheduledFor: new Date('2026-06-06T00:00:00.000Z'),
            status: 'missed',
          },
          {
            scheduledFor: new Date('2026-06-07T00:00:00.000Z'),
            status: 'taken',
          },
        ]),
      },
      userDailyRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            occurredAt: new Date('2026-06-06T00:00:00.000Z'),
            kind: 'water',
            value: '500',
            unit: 'ml',
          },
          {
            occurredAt: new Date('2026-06-06T00:00:00.000Z'),
            kind: 'water',
            value: '1.0',
            unit: 'L',
          },
        ]),
      },
    } as never);

    jest.useFakeTimers().setSystemTime(new Date('2026-06-12T08:00:00.000Z'));

    const dashboard = await service.getDashboard('u1', {
      range: REPORT_RANGE_LAST_7_DAYS,
    });

    expect(dashboard.range).toBe(REPORT_RANGE_LAST_7_DAYS);
    expect(dashboard.metrics).toHaveLength(3);
    expect(dashboard.metrics[0]?.kind).toBe('medication');
    expect(dashboard.metrics[1]?.kind).toBe('water');
    expect(dashboard.metrics[2]?.kind).toBe('sleep');
    expect(dashboard.aiSummaryEnabled).toBe(true);
    expect(dashboard.trends[1]?.values[0]).toBe(1.5);
    expect(dashboard.findings.length).toBeGreaterThan(0);

    jest.useRealTimers();
  });
});
