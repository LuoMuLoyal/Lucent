import { Test } from '@nestjs/testing';
import { DataExportQueueService } from './data-export-queue.service';
import { DataExportProcessorService } from './data-export-processor.service';

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
}));

import { Queue, Worker } from 'bullmq';

describe('DataExportQueueService', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('is not configured when REDIS_URL is missing', async () => {
    delete process.env['REDIS_URL'];

    const module = await Test.createTestingModule({
      providers: [
        DataExportQueueService,
        {
          provide: DataExportProcessorService,
          useValue: { process: jest.fn() },
        },
      ],
    }).compile();
    await module.init();

    const service = module.get<DataExportQueueService>(DataExportQueueService);

    expect(service.isConfigured).toBe(false);
    expect(Queue).not.toHaveBeenCalled();
    expect(Worker).not.toHaveBeenCalled();
  });

  it('initializes the queue and worker when REDIS_URL is set', async () => {
    process.env['REDIS_URL'] = 'redis://localhost:6379';

    const mockQueue = { add: jest.fn(), close: jest.fn() };
    const mockWorker = { on: jest.fn(), close: jest.fn() };
    (Queue as unknown as jest.Mock).mockReturnValue(mockQueue);
    (Worker as unknown as jest.Mock).mockReturnValue(mockWorker);

    const module = await Test.createTestingModule({
      providers: [
        DataExportQueueService,
        {
          provide: DataExportProcessorService,
          useValue: { process: jest.fn() },
        },
      ],
    }).compile();
    await module.init();

    const service = module.get<DataExportQueueService>(DataExportQueueService);

    expect(service.isConfigured).toBe(true);
    expect(Queue).toHaveBeenCalledWith(
      'data-export',
      expect.objectContaining({
        connection: expect.objectContaining({ url: 'redis://localhost:6379' }),
      }),
    );
    expect(Worker).toHaveBeenCalledWith(
      'data-export',
      expect.any(Function),
      expect.objectContaining({
        concurrency: 1,
        autorun: true,
      }),
    );

    await service.onModuleDestroy();
    expect(mockWorker.close).toHaveBeenCalled();
    expect(mockQueue.close).toHaveBeenCalled();
  });

  it('enqueues a job with retry options', async () => {
    process.env['REDIS_URL'] = 'redis://localhost:6379';

    const mockQueue = { add: jest.fn(), close: jest.fn() };
    const mockWorker = { on: jest.fn(), close: jest.fn() };
    (Queue as unknown as jest.Mock).mockReturnValue(mockQueue);
    (Worker as unknown as jest.Mock).mockReturnValue(mockWorker);

    const module = await Test.createTestingModule({
      providers: [
        DataExportQueueService,
        {
          provide: DataExportProcessorService,
          useValue: { process: jest.fn() },
        },
      ],
    }).compile();
    await module.init();

    const service = module.get<DataExportQueueService>(DataExportQueueService);

    await service.enqueue({
      exportRequestId: 'export-1',
      userId: 'user-1',
      language: 'zh-CN',
    });

    expect(mockQueue.add).toHaveBeenCalledWith(
      'export',
      { exportRequestId: 'export-1', userId: 'user-1', language: 'zh-CN' },
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
  });

  it('throws when enqueue is called before the queue is configured', async () => {
    delete process.env['REDIS_URL'];

    const module = await Test.createTestingModule({
      providers: [
        DataExportQueueService,
        {
          provide: DataExportProcessorService,
          useValue: { process: jest.fn() },
        },
      ],
    }).compile();
    await module.init();

    const service = module.get<DataExportQueueService>(DataExportQueueService);

    await expect(
      service.enqueue({
        exportRequestId: 'export-1',
        userId: 'user-1',
        language: 'zh-CN',
      }),
    ).rejects.toThrow('Data export queue is not configured');
  });

  it('delegates the job payload to the processor', async () => {
    process.env['REDIS_URL'] = 'redis://localhost:6379';

    const processor = { process: jest.fn().mockResolvedValue(undefined) };
    const mockQueue = { add: jest.fn(), close: jest.fn() };
    const mockWorker = { on: jest.fn(), close: jest.fn() };
    (Queue as unknown as jest.Mock).mockReturnValue(mockQueue);
    (Worker as unknown as jest.Mock).mockReturnValue(mockWorker);

    const module = await Test.createTestingModule({
      providers: [
        DataExportQueueService,
        {
          provide: DataExportProcessorService,
          useValue: processor,
        },
      ],
    }).compile();
    await module.init();

    module.get<DataExportQueueService>(DataExportQueueService);

    const workerHandler = (Worker as unknown as jest.Mock).mock
      .calls[0][1] as (job: { data: unknown }) => Promise<void>;

    await workerHandler({
      data: {
        exportRequestId: 'export-1',
        userId: 'user-1',
        language: 'zh-CN',
      },
    });

    expect(processor.process).toHaveBeenCalledWith({
      exportRequestId: 'export-1',
      userId: 'user-1',
      language: 'zh-CN',
    });
  });
});
