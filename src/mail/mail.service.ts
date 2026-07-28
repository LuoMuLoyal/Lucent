import { Injectable } from '@nestjs/common';
import { MailQueueService } from './mail-queue.service';
import {
  VERIFICATION_CODE_SUBJECT,
  renderVerificationCodeEmail,
} from './templates';

/**
 * Queues outbound emails via the configured mail queue.
 */
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
    const html = renderVerificationCodeEmail(code);
    await this.send(email, VERIFICATION_CODE_SUBJECT, html);
  }
}
