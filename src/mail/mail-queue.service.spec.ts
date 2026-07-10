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

  const mockQueue = { add: jest.fn(), close: jest.fn() };
  const mockWorker = { on: jest.fn(), close: jest.fn() };
  return {
    isAvailable: true,
    createQueue: () => ({ queue: mockQueue, worker: mockWorker }),
  } as unknown as BullmqQueueFactory;
}

describe('MailQueueService', () => {
  it('should send immediately when REDIS_URL is not configured', async () => {
    const transport = {
      send: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MailTransportService>;
    const service = new MailQueueService(
      {
        get: jest.fn().mockReturnValue(undefined),
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
});
