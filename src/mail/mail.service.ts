import { Injectable } from '@nestjs/common';
import { MailQueueService } from './mail-queue.service.js';
import {
  VERIFICATION_CODE_SUBJECT,
  VERIFICATION_LINK_SUBJECT,
  renderVerificationCodeEmail,
  renderVerificationLinkEmail,
} from './templates.js';

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

  /**
   * Sends a one-time email-verification link (Better Auth token lifecycle).
   */
  async sendVerificationLink(email: string, url: string): Promise<void> {
    const html = renderVerificationLinkEmail(url);
    await this.send(email, VERIFICATION_LINK_SUBJECT, html);
  }
}
