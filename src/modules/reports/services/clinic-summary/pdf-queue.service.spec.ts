import type { Cache } from 'cache-manager';
import type { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { ClinicSummaryPdfQueueService } from './pdf-queue.service.js';
import type { ClinicSummaryService } from './summary.service.js';

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
const mockClinicSummaryService = {
  exportPdf: vi.fn().mockResolvedValue(Buffer.from('pdf')),
} as unknown as ClinicSummaryService;

describe('ClinicSummaryPdfQueueService', () => {
  it('is not configured when Redis is unavailable', () => {
    const { factory } = buildFactory(false);
    const svc = new ClinicSummaryPdfQueueService(
      factory,
      mockCache,
      mockClinicSummaryService,
    );
    expect(svc.isConfigured).toBe(false);
  });

  it('is configured when Redis is available', () => {
    const { factory } = buildFactory(true);
    const svc = new ClinicSummaryPdfQueueService(
      factory,
      mockCache,
      mockClinicSummaryService,
    );
    expect(svc.isConfigured).toBe(true);
  });

  it('returns null from enqueue when queue is not configured', async () => {
    const { factory } = buildFactory(false);
    const svc = new ClinicSummaryPdfQueueService(
      factory,
      mockCache,
      mockClinicSummaryService,
    );
    const result = await svc.enqueue('u1', 'zh-CN');
    expect(result).toBeNull();
  });

  it('returns job id from enqueue when queue is configured', async () => {
    const { factory, mockQueue } = buildFactory(true);
    const svc = new ClinicSummaryPdfQueueService(
      factory,
      mockCache,
      mockClinicSummaryService,
    );
    const result = await svc.enqueue('u1', 'zh-CN');
    expect(result).toBe('job-1');
    expect(mockQueue!.add).toHaveBeenCalledWith('export', {
      userId: 'u1',
      locale: 'zh-CN',
    });
  });
});
