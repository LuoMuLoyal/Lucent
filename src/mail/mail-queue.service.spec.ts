import type { ConfigService } from '@nestjs/config';

import { MailQueueService } from './mail-queue.service';
import type { MailTransportService } from './mail-transport.service';

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
    );

    service.onModuleInit();
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
