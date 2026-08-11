import type { Cache } from 'cache-manager';
import type { BullmqQueueFactory } from '../../../common/queue/queue.factory';
import { TodayAnalysisQueueService } from './analysis-queue.service';
import type { TodayAnalysisService } from './analysis.service';

function buildFactory(available: boolean): {
  factory: BullmqQueueFactory;
  mockQueue: {
    add: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
  } | null;
} {
  if (!available) {
    return {
      factory: {
        isAvailable: false,
        createQueue: () => ({ queue: null, worker: null }),
      } as unknown as BullmqQueueFactory,
      mockQueue: null,
    };
  }
  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    getJob: vi.fn(),
  };
  return {
    factory: {
      isAvailable: true,
      createQueue: () => ({
        queue: mockQueue,
        worker: { on: vi.fn(), close: vi.fn() },
      }),
    } as unknown as BullmqQueueFactory,
    mockQueue,
  };
}

const mockCache = { get: vi.fn(), set: vi.fn() } as unknown as Cache;
const mockAnalysisService = {
  generate: vi.fn(),
  resolveDate: vi.fn((_userId: string, date?: string) =>
    Promise.resolve(date ?? '2026-08-02'),
  ),
} as unknown as TodayAnalysisService;

describe('TodayAnalysisQueueService', () => {
  it('is not configured when Redis is unavailable', () => {
    const { factory } = buildFactory(false);
    const svc = new TodayAnalysisQueueService(
      factory,
      mockCache,
      mockAnalysisService,
    );
    expect(svc.isConfigured).toBe(false);
  });

  it('is configured when Redis is available', () => {
    const { factory } = buildFactory(true);
    const svc = new TodayAnalysisQueueService(
      factory,
      mockCache,
      mockAnalysisService,
    );
    expect(svc.isConfigured).toBe(true);
  });

  it('returns null from enqueue when queue is not configured', async () => {
    const { factory } = buildFactory(false);
    const svc = new TodayAnalysisQueueService(
      factory,
      mockCache,
      mockAnalysisService,
    );
    const result = await svc.enqueue('u1', {} as never, 'zh-CN');
    expect(result).toBeNull();
  });

  it('returns job id from enqueue when queue is configured', async () => {
    const { factory, mockQueue } = buildFactory(true);
    const svc = new TodayAnalysisQueueService(
      factory,
      mockCache,
      mockAnalysisService,
    );
    const dto = { date: '2026-07-14' } as never;
    const result = await svc.enqueue('u1', dto, 'zh-CN');
    expect(result).toBe('job-1');
    expect(mockQueue!.add).toHaveBeenCalledWith('generate', {
      userId: 'u1',
      dto,
      language: 'zh-CN',
    });
  });

  it('uses a stable user/date/version id for event-triggered jobs', async () => {
    const { factory, mockQueue } = buildFactory(true);
    mockQueue!.getJob.mockResolvedValue(null);
    const svc = new TodayAnalysisQueueService(
      factory,
      mockCache,
      mockAnalysisService,
    );

    await svc.enqueue(
      'u1',
      { date: '2026-07-14' },
      'zh-CN',
      7,
      'dose_log_changed',
      'dose-log:d1',
    );

    expect(mockQueue!.add).toHaveBeenCalledWith(
      'generate',
      {
        userId: 'u1',
        dto: { date: '2026-07-14' },
        language: 'zh-CN',
        sourceVersion: 7,
        reasonCode: 'dose_log_changed',
        triggerKey: 'dose-log:d1',
      },
      expect.objectContaining({
        jobId: 'today-analysis:u1:2026-07-14:7',
      }),
    );
  });

  it('uses the resolved profile-local date in a versioned job id', async () => {
    const { factory, mockQueue } = buildFactory(true);
    mockQueue!.getJob.mockResolvedValue(null);
    const svc = new TodayAnalysisQueueService(
      factory,
      mockCache,
      mockAnalysisService,
    );

    await svc.enqueue('u1', {}, 'zh-CN', 7, 'dose_log_changed', 'dose-log:d1');

    expect(mockQueue!.add).toHaveBeenCalledWith(
      'generate',
      expect.objectContaining({
        dto: { date: '2026-08-02' },
        sourceVersion: 7,
      }),
      expect.objectContaining({
        jobId: 'today-analysis:u1:2026-08-02:7',
      }),
    );
  });
});
