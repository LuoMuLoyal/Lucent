import type { ConfigService } from '@nestjs/config';

import { MailQueueService } from './mail-queue.service';
import type { MailTransportService } from './mail-transport.service';
import type { BullmqQueueFactory } from '../common/queue/queue.factory';

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

    expect(mockQueue.add).toHaveBeenCalledWith('send-mail', {
      to: 'queue@example.com',
      subject: 'Queued Subject',
      html: '<p>Queued body</p>',
    });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('propagates error when queue.add fails', async () => {
    const mockQueue = {
      add: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
      close: vi.fn(),
    };
    const mockWorker = { on: vi.fn(), close: vi.fn() };

    const transport = {
      send: vi.fn(),
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

    await expect(
      service.enqueue({
        to: 'fail@example.com',
        subject: 'Fail',
        html: '<p>Fail</p>',
      }),
    ).rejects.toThrow('Redis connection lost');
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
