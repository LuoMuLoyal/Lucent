import { Test, type TestingModule } from '@nestjs/testing';
import type { FastifyReply } from 'fastify';
import { ResultCode, SseConnectionRegistry } from '../../common';
import { TodayAnalysisService } from './services/analysis.service';
import { TodayAnalysisQueueService } from './services/analysis-queue.service';
import { TodayRecommendationsService } from './services/pipeline/recommendations.service';
import type { TodayAnalysisDataDto } from './dto/analysis-response.dto';
import { TodayAnalysisController } from './today-analysis.controller';

describe('TodayAnalysisController', () => {
  let controller: TodayAnalysisController;
  let service: vi.Mocked<TodayAnalysisService>;
  let recommendationsService: vi.Mocked<TodayRecommendationsService>;
  let sseRegistry: SseConnectionRegistry;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TodayAnalysisController],
      providers: [
        {
          provide: TodayAnalysisService,
          useValue: {
            generate: vi.fn(),
            generateStream: vi.fn(),
            readCurrent: vi.fn(),
            resolveDate: vi.fn((_userId: string, date?: string) =>
              Promise.resolve(date ?? '2026-08-02'),
            ),
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
        {
          provide: SseConnectionRegistry,
          useValue: {
            register: vi.fn(),
            unregister: vi.fn(),
            closeAll: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(TodayAnalysisController);
    service = module.get(TodayAnalysisService);
    recommendationsService = module.get(TodayRecommendationsService);
    sseRegistry = module.get(SseConnectionRegistry);
  });

  // ── generate ──────────────────────────────────────────────────────────

  it('reads persisted analysis without generating a new one', async () => {
    const readCurrent = {
      analysis: null,
      status: 'empty',
      sourceVersion: 0,
      computedVersion: 0,
      computedAt: null,
      retryAfterSeconds: null,
    } as const;
    service.readCurrent.mockResolvedValue(readCurrent);

    await expect(
      controller.read(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        '2026-06-12',
        'zh-CN',
      ),
    ).resolves.toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: readCurrent,
    });
    expect(service.generate).not.toHaveBeenCalled();
  });

  it('resolves an omitted controller date through the profile-local date resolver', async () => {
    service.readCurrent.mockResolvedValue({
      analysis: null,
      status: 'empty',
      sourceVersion: 0,
      computedVersion: 0,
      computedAt: null,
      retryAfterSeconds: null,
    });

    await controller.read(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      undefined,
      'zh-CN',
    );

    expect(service.resolveDate).toHaveBeenCalledWith('u1', undefined);
    expect(service.readCurrent).toHaveBeenCalledWith(
      'u1',
      '2026-08-02',
      'zh-CN',
    );
  });

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
    const reply = makeMockReply(events);

    await controller.generateStream(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { date: '2026-06-12' },
      'zh-CN',
      reply,
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
    expect(reply.raw.end).toHaveBeenCalled();
    expect(sseRegistry.register).toHaveBeenCalledWith(reply.raw);
    expect(sseRegistry.unregister).toHaveBeenCalledWith(reply.raw);
  });

  it('writes SSE error event and ends stream when service throws', async () => {
    service.generateStream.mockRejectedValue(new Error('LLM down'));

    const events: Array<{ event: string; data: unknown }> = [];
    const reply = makeMockReply(events);

    await controller.generateStream(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { date: '2026-06-12' },
      'zh-CN',
      reply,
    );

    const errorEvent = events.find((e) => e.event === 'error')!;
    expect(errorEvent).toBeDefined();
    expect(errorEvent.data).toEqual({ message: 'LLM down' });

    // Should still have ended the stream
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it('writes SSE error event with generic message for non-Error', async () => {
    service.generateStream.mockRejectedValue('string error');

    const events: Array<{ event: string; data: unknown }> = [];
    const reply = makeMockReply(events);

    await controller.generateStream(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { date: '2026-06-12' },
      'zh-CN',
      reply,
    );

    const errorEvent = events.find((e) => e.event === 'error')!;
    expect(errorEvent.data).toEqual({ message: 'Unexpected error.' });
  });

  // ── generateAsync ────────────────────────────────────────────────────

  it('generateAsync falls back to synchronous generation when the queue is not configured', async () => {
    const analysis = makeAnalysis();
    service.generate.mockResolvedValue(analysis);

    const result = await controller.generateAsync(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { date: '2026-06-12' },
      'zh-CN',
    );

    expect(service.generate).toHaveBeenCalledWith(
      'u1',
      { date: '2026-06-12' },
      'zh-CN',
    );
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: { result: analysis },
    });
  });

  it('generateAsync returns a jobId when the queue is configured and enqueues', async () => {
    const queue = (
      controller as unknown as {
        todayAnalysisQueueService: {
          isConfigured: boolean;
          enqueue: ReturnType<typeof vi.fn>;
        };
      }
    ).todayAnalysisQueueService;
    queue.isConfigured = true;
    queue.enqueue.mockResolvedValue('job-1');

    const result = await controller.generateAsync(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { date: '2026-06-12' },
      'zh-CN',
    );

    expect(queue.enqueue).toHaveBeenCalledWith(
      'u1',
      { date: '2026-06-12' },
      'zh-CN',
    );
    expect(service.generate).not.toHaveBeenCalled();
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: { jobId: 'job-1' },
    });
  });

  it('generateAsync falls back when enqueue returns null', async () => {
    const queue = (
      controller as unknown as {
        todayAnalysisQueueService: {
          isConfigured: boolean;
          enqueue: ReturnType<typeof vi.fn>;
        };
      }
    ).todayAnalysisQueueService;
    queue.isConfigured = true;
    queue.enqueue.mockResolvedValue(null);
    service.generate.mockResolvedValue(makeAnalysis());

    await controller.generateAsync(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      { date: '2026-06-12' },
      'zh-CN',
    );

    expect(service.generate).toHaveBeenCalled();
  });

  // ── generateStatus ────────────────────────────────────────────────────

  it('generateStatus returns not_found for unknown jobs', async () => {
    const queue = (
      controller as unknown as {
        todayAnalysisQueueService: {
          getStatus: ReturnType<typeof vi.fn>;
        };
      }
    ).todayAnalysisQueueService;
    queue.getStatus.mockResolvedValue(null);

    const result = await controller.generateStatus('job-1');

    expect(queue.getStatus).toHaveBeenCalledWith('job-1');
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: { status: 'not_found' },
    });
  });

  it('generateStatus returns the job status when found', async () => {
    const queue = (
      controller as unknown as {
        todayAnalysisQueueService: {
          getStatus: ReturnType<typeof vi.fn>;
        };
      }
    ).todayAnalysisQueueService;
    queue.getStatus.mockResolvedValue({ status: 'completed', jobId: 'job-1' });

    const result = await controller.generateStatus('job-1');

    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: { status: 'completed', jobId: 'job-1' },
    });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

function makeMockReply(
  events: Array<{ event: string; data: unknown }>,
): FastifyReply {
  let buffer = '';
  const raw = {
    writeHead: vi.fn(),
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
  return { raw } as unknown as FastifyReply;
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
