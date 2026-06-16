import type { MailQueueService } from './mail-queue.service';
import { MailService } from './mail.service';

describe('MailService', () => {
  it('should enqueue generic mail', async () => {
    const queue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MailQueueService>;
    const service = new MailService(queue);

    await service.send('user@example.com', 'Subject', '<p>Body</p>');

    expect(queue.enqueue).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
    });
  });

  it('should enqueue verification code mail', async () => {
    const queue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MailQueueService>;
    const service = new MailService(queue);

    await service.sendVerificationCode('user@example.com', '123456');

    expect(queue.enqueue).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Lucent - 邮箱验证码',
      html: '<p>您的验证码是：<strong>123456</strong></p><p>验证码 5 分钟内有效，请勿泄露给他人。</p>',
    });
  });
});
