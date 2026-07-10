import { MealAnalysisQueueService } from './queue.service';
import type { BullmqQueueFactory } from '../../../../common/queue/queue.factory';
import type { MealAnalysisWorkerService } from './worker.service';

describe('MealAnalysisQueueService', () => {
  let service: MealAnalysisQueueService;
  let factory: jest.Mocked<BullmqQueueFactory>;
  let workerService: jest.Mocked<MealAnalysisWorkerService>;
  let mockQueue: { add: jest.Mock };

  beforeEach(() => {
    workerService = {
      process: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MealAnalysisWorkerService>;

    mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
  });

  describe('with Redis queue available', () => {
    beforeEach(() => {
      factory = {
        createQueue: jest.fn().mockReturnValue({
          queue: mockQueue,
          worker: {},
        }),
      } as unknown as jest.Mocked<BullmqQueueFactory>;

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

    it('enqueues job with correct jobId format', async () => {
      await service.enqueue({
        userId: 'user-1',
        recordId: 'rec-1',
        sourceRevision: 3,
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        expect.any(String),
        { userId: 'user-1', recordId: 'rec-1', sourceRevision: 3 },
        { jobId: 'rec-1:3' },
      );
      expect(workerService.process).not.toHaveBeenCalled();
    });

    it('enqueues different jobs for different revisions', async () => {
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
      expect(mockQueue.add).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.any(Object),
        { jobId: 'rec-1:1' },
      );
      expect(mockQueue.add).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.any(Object),
        { jobId: 'rec-1:2' },
      );
    });
  });

  describe('without Redis queue (fallback)', () => {
    beforeEach(() => {
      factory = {
        createQueue: jest.fn().mockReturnValue({ queue: null, worker: null }),
      } as unknown as jest.Mocked<BullmqQueueFactory>;

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
