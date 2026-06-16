import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api-envelope';
import { TodayAnalysisService } from './analysis/today-analysis.service';
import type { TodayAnalysisDataDto } from './dto';
import { TodayAnalysisController } from './today-analysis.controller';

describe('TodayAnalysisController', () => {
  let controller: TodayAnalysisController;
  let service: jest.Mocked<TodayAnalysisService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TodayAnalysisController],
      providers: [
        {
          provide: TodayAnalysisService,
          useValue: {
            generate: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(TodayAnalysisController);
    service = module.get(TodayAnalysisService);
  });

  it('should return today analysis envelope', async () => {
    const analysis = makeAnalysis();
    service.generate.mockResolvedValue(analysis);

    await expect(
      controller.generate(
        { sub: 'u1', email: 'a@b.c' },
        { date: '2026-06-12' },
        'zh-CN',
      ),
    ).resolves.toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: analysis,
    });

    expect(service.generate).toHaveBeenCalledWith(
      'u1',
      {
        date: '2026-06-12',
      },
      'zh-CN',
    );
  });
});

function makeAnalysis(
  overrides: Partial<TodayAnalysisDataDto> = {},
): TodayAnalysisDataDto {
  return {
    date: '2026-06-12',
    generatedAt: '2026-06-12T08:00:00.000Z',
    summary: '今日记录主要集中在饮水和用药，仍有一项待确认。',
    bullets: [
      {
        kind: 'medication',
        text: '还有 1 项今日用药待确认，先核对是否已经服用。',
      },
      {
        kind: 'hydration',
        text: '今日饮水仍未达目标，建议下午和晚间各补 1 次。',
      },
      {
        kind: 'sleep',
        text: '今天还没有真实睡眠数据，今晚记录后总结会更完整。',
      },
    ],
    actionLabel: '查看今日记录',
    confidenceNote: '仅基于今日已记录数据生成，不构成诊断或治疗建议。',
    ...overrides,
  };
}
