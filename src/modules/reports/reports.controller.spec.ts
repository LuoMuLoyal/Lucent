import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api-envelope';
import { REPORT_RANGE_LAST_7_DAYS, type ReportDashboardDataDto } from './dto';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

describe('ReportsController', () => {
  let controller: ReportsController;
  let service: jest.Mocked<ReportsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        {
          provide: ReportsService,
          useValue: {
            getDashboard: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(ReportsController);
    service = module.get(ReportsService);
  });

  it('should return report dashboard envelope', async () => {
    const dashboard = makeDashboard();
    service.getDashboard.mockResolvedValue(dashboard);

    expect(
      await controller.getDashboard(
        { sub: 'u1', email: 'a@b.c' },
        { range: REPORT_RANGE_LAST_7_DAYS },
      ),
    ).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: dashboard,
    });
    expect(service.getDashboard).toHaveBeenCalledWith('u1', {
      range: REPORT_RANGE_LAST_7_DAYS,
    });
  });
});

function makeDashboard(
  overrides: Partial<ReportDashboardDataDto> = {},
): ReportDashboardDataDto {
  return {
    range: REPORT_RANGE_LAST_7_DAYS,
    startDate: '2026-06-06',
    endDate: '2026-06-12',
    generatedAt: '2026-06-12T00:00:00.000Z',
    score: {
      value: 78,
      maxValue: 100,
      status: 'stable',
      summary: '本周记录较完整。',
    },
    metrics: [],
    trends: [],
    findings: [],
    patterns: [],
    aiSummaryEnabled: false,
    ...overrides,
  };
}
