import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { ResultCode } from '../../common/api';
import { TodayAnalysisService } from './services/analysis.service';
import { TodayAnalysisQueueService } from './services/analysis-queue.service';
import { TodayRecommendationsService } from './services/recommendations.service';
import type { TodayAnalysisDataDto } from './dto';
import { TodayAnalysisController } from './today-analysis.controller';

describe('TodayAnalysisController', () => {
  let controller: TodayAnalysisController;
  let service: vi.Mocked<TodayAnalysisService>;
  let recommendationsService: vi.Mocked<TodayRecommendationsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TodayAnalysisController],
      providers: [
        {
          provide: TodayAnalysisService,
          useValue: {
            generate: vi.fn(),
            generateStream: vi.fn(),
          },
        },
        {
          provide: TodayAnalysisQueueService,
          useValue: {
            isConfigured: false,
            enqueue: vi.fn(),
            getStatus: vi.fn(),
          },
        },
        {
          provide: TodayRecommendationsService,
          useValue: {
            getRandomRecommendations: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(TodayAnalysisController);
    service = module.get(TodayAnalysisService);
    recommendationsService = module.get(TodayRecommendationsService);
  });

  // ── generate ──────────────────────────────────────────────────────────

  it('should return today analysis envelope', async () => {
    const analysis = makeAnalysis();
    service.generate.mockResolvedValue(analysis);

    await expect(
      controller.generate(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
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

  // ── getRecommendations ────────────────────────────────────────────────

  it('returns recommendations with single exclude string', () => {
    const recs = [
      { id: 'sleep', text: '今晚早睡 15 分钟。', category: 'sleep' },
    ];
    recommendationsService.getRandomRecommendations.mockReturnValue(recs);

    const result = controller.getRecommendations('hydration', 'zh-CN');

    expect(
      recommendationsService.getRandomRecommendations,
    ).toHaveBeenCalledWith(['hydration'], 'zh-CN');
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: recs,
    });
  });

  it('returns recommendations with array exclude', () => {
    const recs = [
      { id: 'sleep', text: 'Go to bed 15 minutes earlier.', category: 'sleep' },
    ];
    recommendationsService.getRandomRecommendations.mockReturnValue(recs);

    const result = controller.getRecommendations(['hydration', 'walk'], 'en');

    expect(
      recommendationsService.getRandomRecommendations,
    ).toHaveBeenCalledWith(['hydration', 'walk'], 'en');
    expect(result.data).toEqual(recs);
  });

  it('returns recommendations with no exclude', () => {
    const recs = [{ id: 'hydration', text: 'Drink water.' }];
    recommendationsService.getRandomRecommendations.mockReturnValue(recs);

    const result = controller.getRecommendations(undefined, 'en');

    expect(
      recommendationsService.getRandomRecommendations,
    ).toHaveBeenCalledWith([], 'en');
    expect(result.data).toEqual(recs);
  });

  // ── generateStream ────────────────────────────────────────────────────

  it('writes SSE events for summary, result, and done on success', async () => {
    const analysisResult = makeAnalysis();
    service.generateStream.mockImplementation(
      async (_userId, _dto, _lang, onSummary) => {
        await onSummary({ summary: 'partial text' });
        return analysisResult;
      },
    );

    const events: Array<{ event: string; data: unknown }> = [];
    const response = makeMockResponse(events);

    await controller.generateStream(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { date: '2026-06-12' },
      'zh-CN',
      response,
    );

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain('summary');
    expect(eventTypes).toContain('result');
    expect(eventTypes).toContain('done');

    const summaryEvent = events.find((e) => e.event === 'summary')!;
    expect(summaryEvent.data).toEqual({ summary: 'partial text' });

    const resultEvent = events.find((e) => e.event === 'result')!;
    expect(resultEvent.data).toEqual(analysisResult);

    // response.end should have been called (by endSse)
    expect(response.end).toHaveBeenCalled();
  });

  it('writes SSE error event and ends stream when service throws', async () => {
    service.generateStream.mockRejectedValue(new Error('LLM down'));

    const events: Array<{ event: string; data: unknown }> = [];
    const response = makeMockResponse(events);

    await controller.generateStream(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { date: '2026-06-12' },
      'zh-CN',
      response,
    );

    const errorEvent = events.find((e) => e.event === 'error')!;
    expect(errorEvent).toBeDefined();
    expect(errorEvent.data).toEqual({ message: 'LLM down' });

    // Should still have ended the stream
    expect(response.end).toHaveBeenCalled();
  });

  it('writes SSE error event with generic message for non-Error', async () => {
    service.generateStream.mockRejectedValue('string error');

    const events: Array<{ event: string; data: unknown }> = [];
    const response = makeMockResponse(events);

    await controller.generateStream(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { date: '2026-06-12' },
      'zh-CN',
      response,
    );

    const errorEvent = events.find((e) => e.event === 'error')!;
    expect(errorEvent.data).toEqual({ message: 'Unexpected error.' });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

function makeMockResponse(
  events: Array<{ event: string; data: unknown }>,
): Response {
  let buffer = '';
  const res = {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    flushHeaders: vi.fn().mockReturnThis(),
    write: vi.fn((chunk: string) => {
      buffer += chunk;
      // SSE events are separated by \n\n
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const eventMatch = part.match(/event: (\w+)/);
        const dataMatch = part.match(/data: (.+)/);
        if (eventMatch && dataMatch) {
          events.push({
            event: eventMatch[1]!,
            data: JSON.parse(dataMatch[1]!),
          });
        }
      }
    }),
    end: vi.fn(),
  };
  return res as unknown as Response;
}

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
    action: 'today',
    confidenceNote: '仅基于今日已记录数据生成，不构成诊断或治疗建议。',
    ...overrides,
  };
}
