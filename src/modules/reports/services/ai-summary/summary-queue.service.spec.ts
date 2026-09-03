import type { Cache } from 'cache-manager';
import type { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { ReportSummaryQueueService } from './summary-queue.service.js';
import type { ReportsAiSummaryService } from './summary.service.js';

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
const mockSummaryService = {
  generate: vi.fn(),
} as unknown as ReportsAiSummaryService;

describe('ReportSummaryQueueService', () => {
  it('is not configured when Redis is unavailable', () => {
    const { factory } = buildFactory(false);
    const svc = new ReportSummaryQueueService(
      factory,
      mockCache,
      mockSummaryService,
    );
    expect(svc.isConfigured).toBe(false);
  });

  it('is configured when Redis is available', () => {
    const { factory } = buildFactory(true);
    const svc = new ReportSummaryQueueService(
      factory,
      mockCache,
      mockSummaryService,
    );
    expect(svc.isConfigured).toBe(true);
  });

  it('returns null from enqueue when queue is not configured', async () => {
    const { factory } = buildFactory(false);
    const svc = new ReportSummaryQueueService(
      factory,
      mockCache,
      mockSummaryService,
    );
    const result = await svc.enqueue('u1', {} as never, 'zh-CN');
    expect(result).toBeNull();
  });

  it('returns job id from enqueue when queue is configured', async () => {
    const { factory, mockQueue } = buildFactory(true);
    const svc = new ReportSummaryQueueService(
      factory,
      mockCache,
      mockSummaryService,
    );
    const dto = { startDate: '2026-07-01', endDate: '2026-07-14' } as never;
    const result = await svc.enqueue('u1', dto, 'zh-CN');
    expect(result).toBe('job-1');
    expect(mockQueue!.add).toHaveBeenCalledWith('generate', {
      userId: 'u1',
      dto,
      language: 'zh-CN',
    });
  });
});
