import { Injectable } from '@nestjs/common';
import { MailQueueService } from './mail-queue.service';

@Injectable()
export class MailService {
  constructor(private readonly mailQueueService: MailQueueService) {}

  async send(to: string, subject: string, html: string): Promise<void> {
    await this.mailQueueService.enqueue({ to, subject, html });
  }

  /**
   * Convenience method for sending a verification code.
   */
  async sendVerificationCode(email: string, code: string): Promise<void> {
    const subject = 'Lucent - 邮箱验证码';
    const html = `<p>您的验证码是：<strong>${code}</strong></p><p>验证码 5 分钟内有效，请勿泄露给他人。</p>`;
    await this.send(email, subject, html);
  }
}
