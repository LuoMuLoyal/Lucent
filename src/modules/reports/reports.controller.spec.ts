import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api-envelope';
import {
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_LAST_7_DAYS,
  type ReportDashboardDataDto,
  type ReportSummaryDataDto,
} from './dto';
import { ReportsAiSummaryService } from './reports-ai-summary.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

describe('ReportsController', () => {
  let controller: ReportsController;
  let service: jest.Mocked<ReportsService>;
  let aiSummaryService: jest.Mocked<ReportsAiSummaryService>;

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
        {
          provide: ReportsAiSummaryService,
          useValue: {
            generate: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(ReportsController);
    service = module.get(ReportsService);
    aiSummaryService = module.get(ReportsAiSummaryService);
  });

  it('should return report dashboard envelope', async () => {
    const dashboard = makeDashboard();
    service.getDashboard.mockResolvedValue(dashboard);

    expect(
      await controller.getDashboard(
        { sub: 'u1', email: 'a@b.c' },
        { range: REPORT_RANGE_LAST_7_DAYS },
        'en',
      ),
    ).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: dashboard,
    });
    expect(service.getDashboard).toHaveBeenCalledWith(
      'u1',
      { range: REPORT_RANGE_LAST_7_DAYS },
      'en',
    );
  });

  it('should return report summary envelope', async () => {
    const summary = makeSummary();
    aiSummaryService.generate.mockResolvedValue(summary);

    expect(
      await controller.generateSummary(
        { sub: 'u1', email: 'a@b.c' },
        { range: REPORT_RANGE_LAST_30_DAYS },
        'zh-CN',
      ),
    ).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: summary,
    });
    expect(aiSummaryService.generate).toHaveBeenCalledWith(
      'u1',
      {
        range: REPORT_RANGE_LAST_30_DAYS,
      },
      'zh-CN',
    );
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

function makeSummary(
  overrides: Partial<ReportSummaryDataDto> = {},
): ReportSummaryDataDto {
  return {
    range: REPORT_RANGE_LAST_30_DAYS,
    startDate: '2026-05-14',
    endDate: '2026-06-12',
    generatedAt: '2026-06-12T08:00:00.000Z',
    summary: '本月记录已更新。',
    bullets: [
      {
        kind: 'medication',
        text: '本月用药节奏整体稳定。',
      },
      {
        kind: 'hydration',
        text: '饮水仍有几天偏低。',
      },
    ],
    actionLabel: '查看报告',
    confidenceNote: '仅基于近 30 天已记录数据生成，不构成诊断或治疗建议。',
    ...overrides,
  };
}
