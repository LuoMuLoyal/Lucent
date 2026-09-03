import { DataExportQueueService } from './queue.service.js';
import type { DataExportProcessorService } from './processor.service.js';
import type { BullmqQueueFactory } from '../../../common/queue/queue.factory.js';

function buildFactory(queueAvailable: boolean): {
  factory: BullmqQueueFactory;
  mockQueue: { add: vi.Mock; close: vi.Mock } | null;
} {
  if (!queueAvailable) {
    return {
      factory: {
        isAvailable: false,
        createQueue: () => ({ queue: null, worker: null }),
      } as unknown as BullmqQueueFactory,
      mockQueue: null,
    };
  }

  const mockQueue = { add: vi.fn(), close: vi.fn() };
  const mockWorker = { on: vi.fn(), close: vi.fn() };
  return {
    factory: {
      isAvailable: true,
      createQueue: () => ({ queue: mockQueue, worker: mockWorker }),
    } as unknown as BullmqQueueFactory,
    mockQueue,
  };
}

describe('DataExportQueueService', () => {
  it('is not configured when REDIS_URL is missing', () => {
    const { factory } = buildFactory(false);
    const processor = {
      process: vi.fn(),
    } as unknown as DataExportProcessorService;
    const service = new DataExportQueueService(factory, processor);

    expect(service.isConfigured).toBe(false);
  });

  it('is configured when the factory has Redis available', () => {
    const { factory } = buildFactory(true);
    const processor = {
      process: vi.fn(),
    } as unknown as DataExportProcessorService;
    const service = new DataExportQueueService(factory, processor);

    expect(service.isConfigured).toBe(true);
  });

  it('enqueues a job with retry options', async () => {
    const { factory, mockQueue } = buildFactory(true);
    const processor = {
      process: vi.fn(),
    } as unknown as DataExportProcessorService;
    const service = new DataExportQueueService(factory, processor);

    await service.enqueue({
      exportRequestId: 'export-1',
      userId: 'user-1',
      language: 'zh-CN',
    });

    expect(mockQueue!.add).toHaveBeenCalledWith(
      'export',
      { exportRequestId: 'export-1', userId: 'user-1', language: 'zh-CN' },
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
  });

  it('throws when enqueue is called before the queue is configured', async () => {
    const { factory } = buildFactory(false);
    const processor = {
      process: vi.fn(),
    } as unknown as DataExportProcessorService;
    const service = new DataExportQueueService(factory, processor);

    await expect(
      service.enqueue({
        exportRequestId: 'export-1',
        userId: 'user-1',
        language: 'zh-CN',
      }),
    ).rejects.toMatchObject({
      failure: {
        code: 'DEPENDENCY_UNAVAILABLE',
        detail: 'Data export queue is not configured',
      },
    });
  });
});
