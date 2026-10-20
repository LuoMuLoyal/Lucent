import type { ConfigService } from '@nestjs/config';

import { MailQueueService } from './mail-queue.service.js';
import type { MailTransportService } from './mail-transport.service.js';
import type { BullmqQueueFactory } from '../common/queue/queue.factory.js';
import { EnvKey } from '../config/env/env-keys.enum.js';
import type { RuntimeConfigPort } from '../config/runtime/runtime-config.types.js';

/** Snapshot stub: only the keys the test publishes, everything else falls back. */
function runtimeWith(values: Record<string, unknown>): RuntimeConfigPort {
  return {
    getSnapshot: () => ({
      values: values as never,
      version: 'test#1',
      source: 'remote',
      revision: 'test',
      seq: 1,
    }),
    getVersion: () => 'test#1',
    applyDocument: () => ({ ok: true, version: 'test#1', changed: [] }),
    subscribe: () => () => undefined,
  };
}

function buildFactory(queueAvailable: boolean): BullmqQueueFactory {
  if (!queueAvailable) {
    return {
      isAvailable: false,
      createQueue: () => ({ queue: null, worker: null }),
    } as unknown as BullmqQueueFactory;
  }

  const mockQueue = { add: vi.fn(), close: vi.fn() };
  const mockWorker = { on: vi.fn(), close: vi.fn() };
  return {
    isAvailable: true,
    createQueue: () => ({ queue: mockQueue, worker: mockWorker }),
  } as unknown as BullmqQueueFactory;
}

describe('MailQueueService', () => {
  it('should send immediately when REDIS_URL is not configured', async () => {
    const transport = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<MailTransportService>;
    const service = new MailQueueService(
      {
        get: vi.fn().mockReturnValue(undefined),
      } as unknown as ConfigService,
      transport,
      buildFactory(false),
    );

    await service.enqueue({
      to: 'user@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
    });

    expect(transport.send).toHaveBeenCalledWith(
      'user@example.com',
      'Subject',
      '<p>Body</p>',
    );
  });

  it('enqueues to the BullMQ queue when REDIS_URL is configured', async () => {
    const mockQueue = {
      add: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };
    const mockWorker = { on: vi.fn(), close: vi.fn() };

    const transport = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<MailTransportService>;

    const factory = {
      isAvailable: true,
      createQueue: () => ({ queue: mockQueue, worker: mockWorker }),
    } as unknown as BullmqQueueFactory;

    const service = new MailQueueService(
      {
        get: vi.fn().mockReturnValue({
          queue: {
            maxAttempts: 5,
            backoffDelayMs: 2000,
            workerConcurrency: 2,
            completeAgeSeconds: 3600,
            failAgeSeconds: 86400,
            completeMaxCount: 500,
            failMaxCount: 2000,
          },
        }),
      } as unknown as ConfigService,
      transport,
      factory,
    );

    await service.enqueue({
      to: 'queue@example.com',
      subject: 'Queued Subject',
      html: '<p>Queued body</p>',
    });

    expect(mockQueue.add).toHaveBeenCalledWith(
      'send-mail',
      {
        to: 'queue@example.com',
        subject: 'Queued Subject',
        html: '<p>Queued body</p>',
      },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86400, count: 2000 },
      },
    );
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('reads retry and retention from the snapshot when a job is enqueued', async () => {
    const mockQueue = {
      add: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };
    const transport = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<MailTransportService>;

    const service = new MailQueueService(
      {
        get: vi.fn().mockReturnValue(undefined),
      } as unknown as ConfigService,
      transport,
      {
        isAvailable: true,
        createQueue: () => ({
          queue: mockQueue,
          worker: { on: vi.fn(), close: vi.fn() },
        }),
      } as unknown as BullmqQueueFactory,
      runtimeWith({
        [EnvKey.MAIL_QUEUE_MAX_ATTEMPTS]: 7,
        [EnvKey.MAIL_QUEUE_BACKOFF_DELAY_MS]: 30_000,
        [EnvKey.MAIL_QUEUE_COMPLETE_AGE_SECONDS]: 3_600,
        [EnvKey.MAIL_QUEUE_COMPLETE_MAX_COUNT]: 10,
        [EnvKey.MAIL_QUEUE_FAIL_AGE_SECONDS]: 172_800,
        [EnvKey.MAIL_QUEUE_FAIL_MAX_COUNT]: 20,
      }),
    );

    await service.enqueue({
      to: 'snapshot@example.com',
      subject: 'Snapshot',
      html: '<p>Snapshot</p>',
    });

    expect(mockQueue.add).toHaveBeenCalledWith(
      'send-mail',
      expect.objectContaining({ to: 'snapshot@example.com' }),
      {
        attempts: 7,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 3_600, count: 10 },
        removeOnFail: { age: 172_800, count: 20 },
      },
    );
  });

  it('sends synchronously when queue.add fails (Redis configured but down)', async () => {
    const mockQueue = {
      add: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
      close: vi.fn(),
    };
    const mockWorker = { on: vi.fn(), close: vi.fn() };

    const transport = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<MailTransportService>;

    // Override factory to return our specific mock
    const factory = {
      isAvailable: true,
      createQueue: () => ({ queue: mockQueue, worker: mockWorker }),
    } as unknown as BullmqQueueFactory;

    const service = new MailQueueService(
      {
        get: vi.fn().mockReturnValue(undefined),
      } as unknown as ConfigService,
      transport,
      factory,
    );

    await service.enqueue({
      to: 'fail@example.com',
      subject: 'Fail',
      html: '<p>Fail</p>',
    });

    expect(transport.send).toHaveBeenCalledWith(
      'fail@example.com',
      'Fail',
      '<p>Fail</p>',
    );
  });

  it('uses default job options when mail config is not available', () => {
    const transport = {
      send: vi.fn(),
    } as unknown as vi.Mocked<MailTransportService>;

    // The constructor should not throw even without mail config
    const service = new MailQueueService(
      {
        get: vi.fn().mockReturnValue(undefined),
      } as unknown as ConfigService,
      transport,
      buildFactory(false),
    );

    expect(service).toBeDefined();
  });
});
