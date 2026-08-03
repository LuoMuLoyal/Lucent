import { MealAnalysisQueueService } from './queue.service';
import type { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
import type { MealAnalysisWorkerService } from './worker.service';

describe('MealAnalysisQueueService', () => {
  let service: MealAnalysisQueueService;
  let factory: vi.Mocked<BullmqQueueFactory>;
  let workerService: vi.Mocked<MealAnalysisWorkerService>;
  let mockQueue: { add: vi.Mock };

  beforeEach(() => {
    workerService = {
      process: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<MealAnalysisWorkerService>;

    mockQueue = { add: vi.fn().mockResolvedValue(undefined) };
  });

  describe('with Redis queue available', () => {
    beforeEach(() => {
      factory = {
        createQueue: vi.fn().mockReturnValue({
          queue: mockQueue,
          worker: {},
        }),
      } as unknown as vi.Mocked<BullmqQueueFactory>;

      service = new MealAnalysisQueueService(factory, workerService);
    });

    it('creates queue on construction', () => {
      expect(factory.createQueue).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.any(String),
          workerConcurrency: 1,
        }),
      );
    });

    it('enqueues job without a deterministic jobId', async () => {
      await service.enqueue({
        userId: 'user-1',
        recordId: 'rec-1',
        sourceRevision: 3,
      });

      expect(mockQueue.add).toHaveBeenCalledWith(expect.any(String), {
        userId: 'user-1',
        recordId: 'rec-1',
        sourceRevision: 3,
      });
      expect(workerService.process).not.toHaveBeenCalled();
    });

    it('enqueues every revision as a fresh job', async () => {
      await service.enqueue({
        userId: 'user-1',
        recordId: 'rec-1',
        sourceRevision: 1,
      });
      await service.enqueue({
        userId: 'user-1',
        recordId: 'rec-1',
        sourceRevision: 2,
      });

      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenNthCalledWith(1, expect.any(String), {
        userId: 'user-1',
        recordId: 'rec-1',
        sourceRevision: 1,
      });
      expect(mockQueue.add).toHaveBeenNthCalledWith(2, expect.any(String), {
        userId: 'user-1',
        recordId: 'rec-1',
        sourceRevision: 2,
      });
    });

    it('falls back to direct processing when queue.add throws', async () => {
      mockQueue.add = vi
        .fn()
        .mockRejectedValue(new Error('Redis connection lost'));
      const jobData = {
        userId: 'user-1',
        recordId: 'rec-1',
        sourceRevision: 3,
      };

      await service.enqueue(jobData);

      expect(workerService.process).toHaveBeenCalledWith(jobData);
    });
  });

  describe('without Redis queue (fallback)', () => {
    beforeEach(() => {
      factory = {
        createQueue: vi.fn().mockReturnValue({ queue: null, worker: null }),
      } as unknown as vi.Mocked<BullmqQueueFactory>;

      service = new MealAnalysisQueueService(factory, workerService);
    });

    it('processes job directly when queue is null', async () => {
      const jobData = {
        userId: 'user-1',
        recordId: 'rec-1',
        sourceRevision: 1,
      };

      await service.enqueue(jobData);

      expect(workerService.process).toHaveBeenCalledWith(jobData);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });
});
