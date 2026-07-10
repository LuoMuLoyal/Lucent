import type { ConfigService } from '@nestjs/config';
import {
  BullmqQueueFactory,
  DEFAULT_QUEUE_OPTIONS,
  DEFAULT_WORKER_RETENTION,
} from './queue.factory';
import type { MetricsService } from '../metrics/metrics.service';
describe('BullmqQueueFactory', () => {
  let configService: jest.Mocked<ConfigService>;
  let metricsService: jest.Mocked<MetricsService>;

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    metricsService = {
      recordBullmqJob: jest.fn(),
    } as unknown as jest.Mocked<MetricsService>;
  });

  describe('isAvailable', () => {
    it('returns false when REDIS_URL is not set', () => {
      configService.get.mockReturnValue(undefined);
      const factory = new BullmqQueueFactory(configService, metricsService);
      expect(factory.isAvailable).toBe(false);
    });

    it('returns false when REDIS_URL is empty string', () => {
      configService.get.mockReturnValue('  ');
      const factory = new BullmqQueueFactory(configService, metricsService);
      expect(factory.isAvailable).toBe(false);
    });

    it('returns true when REDIS_URL is set', () => {
      configService.get.mockReturnValue('redis://127.0.0.1:6379');
      const factory = new BullmqQueueFactory(configService, metricsService);
      expect(factory.isAvailable).toBe(true);
    });
  });

  describe('createQueue', () => {
    it('returns null queue and worker when Redis is not configured', () => {
      configService.get.mockReturnValue(undefined);
      const factory = new BullmqQueueFactory(configService, metricsService);

      const result = factory.createQueue({
        name: 'test-queue',
        processor: jest.fn(),
      });

      expect(result.queue).toBeNull();
      expect(result.worker).toBeNull();
    });

    it('creates queue and worker when Redis is configured', async () => {
      configService.get.mockReturnValue('redis://127.0.0.1:6379');
      const factory = new BullmqQueueFactory(configService, metricsService);

      const result = factory.createQueue({
        name: 'test-queue',
        processor: jest.fn(),
      });

      expect(result.queue).not.toBeNull();
      expect(result.worker).not.toBeNull();
      expect(result.queue?.name).toBe('test-queue');

      await factory.onModuleDestroy();
    });
  });

  describe('onModuleDestroy', () => {
    it('closes all managed queues and workers', async () => {
      configService.get.mockReturnValue('redis://127.0.0.1:6379');
      const factory = new BullmqQueueFactory(configService, metricsService);

      const { queue, worker } = factory.createQueue({
        name: 'test-queue',
        processor: jest.fn(),
      });

      const queueCloseSpy = jest.spyOn(queue!, 'close').mockResolvedValue();
      const workerCloseSpy = jest.spyOn(worker!, 'close').mockResolvedValue();

      await factory.onModuleDestroy();

      expect(workerCloseSpy).toHaveBeenCalled();
      expect(queueCloseSpy).toHaveBeenCalled();
    });
  });

  describe('constants', () => {
    it('DEFAULT_QUEUE_OPTIONS has correct attempts', () => {
      expect(DEFAULT_QUEUE_OPTIONS.attempts).toBe(3);
    });

    it('DEFAULT_QUEUE_OPTIONS has exponential backoff', () => {
      expect(DEFAULT_QUEUE_OPTIONS.backoff).toEqual({
        type: 'exponential',
        delay: 5_000,
      });
    });

    it('DEFAULT_WORKER_RETENTION has removeOnComplete', () => {
      expect(DEFAULT_WORKER_RETENTION.removeOnComplete).toBeDefined();
    });

    it('DEFAULT_WORKER_RETENTION has removeOnFail', () => {
      expect(DEFAULT_WORKER_RETENTION.removeOnFail).toBeDefined();
    });
  });
});
