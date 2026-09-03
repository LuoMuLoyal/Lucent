import type { ConfigService } from '@nestjs/config';
import {
  BullmqQueueFactory,
  DEFAULT_QUEUE_OPTIONS,
  DEFAULT_WORKER_RETENTION,
  QUEUE_METRICS_POLL_INTERVAL_MS,
} from './queue.factory.js';
import type { MetricsService } from '../metrics/metrics.service.js';
describe('BullmqQueueFactory', () => {
  let configService: vi.Mocked<ConfigService>;
  let metricsService: vi.Mocked<MetricsService>;

  beforeEach(() => {
    configService = {
      get: vi.fn(),
    } as unknown as vi.Mocked<ConfigService>;
    // OTEL_ENABLED defaults to 'false' so telemetry is not activated in tests.
    configService.get.mockImplementation((key: string) =>
      key === 'OTEL_ENABLED' ? 'false' : undefined,
    );

    metricsService = {
      recordBullmqJob: vi.fn(),
      setBullmqActiveJobs: vi.fn(),
      setBullmqWaitingJobs: vi.fn(),
    } as unknown as vi.Mocked<MetricsService>;
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
      configService.get.mockImplementation((key: string) =>
        key === 'REDIS_URL' ? 'redis://127.0.0.1:6379' : undefined,
      );
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
        processor: vi.fn(),
      });

      expect(result.queue).toBeNull();
      expect(result.worker).toBeNull();
    });

    it('creates queue and worker when Redis is configured', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'REDIS_URL' ? 'redis://127.0.0.1:6379' : undefined,
      );
      const factory = new BullmqQueueFactory(configService, metricsService);

      const result = factory.createQueue({
        name: 'test-queue',
        processor: vi.fn(),
      });

      expect(result.queue).not.toBeNull();
      expect(result.worker).not.toBeNull();
      expect(result.queue?.name).toBe('test-queue');

      await factory.onModuleDestroy();
    });
  });

  describe('onModuleDestroy', () => {
    it('closes all managed queues and workers', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'REDIS_URL' ? 'redis://127.0.0.1:6379' : undefined,
      );
      const factory = new BullmqQueueFactory(configService, metricsService);

      const { queue, worker } = factory.createQueue({
        name: 'test-queue',
        processor: vi.fn(),
      });

      const queueCloseSpy = vi.spyOn(queue!, 'close').mockResolvedValue();
      const workerCloseSpy = vi.spyOn(worker!, 'close').mockResolvedValue();

      await factory.onModuleDestroy();

      expect(workerCloseSpy).toHaveBeenCalled();
      expect(queueCloseSpy).toHaveBeenCalled();
    });
  });

  describe('metrics polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('writes active/waiting job counts to the gauges on each interval', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'REDIS_URL' ? 'redis://127.0.0.1:6379' : undefined,
      );
      const factory = new BullmqQueueFactory(configService, metricsService);

      const { queue, worker } = factory.createQueue({
        name: 'test-queue',
        processor: vi.fn(),
      });
      const getJobCountsSpy = vi
        .spyOn(queue!, 'getJobCounts')
        .mockResolvedValue({ active: 3, waiting: 7 });

      await vi.advanceTimersByTimeAsync(QUEUE_METRICS_POLL_INTERVAL_MS);

      expect(getJobCountsSpy).toHaveBeenCalledWith('active', 'waiting');
      expect(metricsService.setBullmqActiveJobs).toHaveBeenCalledWith(
        'test-queue',
        3,
      );
      expect(metricsService.setBullmqWaitingJobs).toHaveBeenCalledWith(
        'test-queue',
        7,
      );

      vi.spyOn(queue!, 'close').mockResolvedValue();
      vi.spyOn(worker!, 'close').mockResolvedValue();
      await factory.onModuleDestroy();
    });

    it('stops polling after onModuleDestroy', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'REDIS_URL' ? 'redis://127.0.0.1:6379' : undefined,
      );
      const factory = new BullmqQueueFactory(configService, metricsService);

      const { queue, worker } = factory.createQueue({
        name: 'test-queue',
        processor: vi.fn(),
      });
      const getJobCountsSpy = vi
        .spyOn(queue!, 'getJobCounts')
        .mockResolvedValue({ active: 0, waiting: 0 });
      vi.spyOn(queue!, 'close').mockResolvedValue();
      vi.spyOn(worker!, 'close').mockResolvedValue();

      await factory.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(QUEUE_METRICS_POLL_INTERVAL_MS * 2);

      expect(getJobCountsSpy).not.toHaveBeenCalled();
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
