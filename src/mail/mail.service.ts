import { Injectable } from '@nestjs/common';
import { MailQueueService } from './mail-queue.service.js';
import {
  renderVerificationCodeEmail,
  renderVerificationLinkEmail,
  verificationCodeSubject,
  verificationLinkSubject,
} from './templates.js';

/**
 * Queues outbound emails via the configured mail queue.
 *
 * Emails are rendered in the request locale (passed as an ISO locale string)
 * so they match the language the user is using in the product; English is the
 * fallback for unsupported locales.
 */
@Injectable()
export class MailService {
  constructor(private readonly mailQueueService: MailQueueService) {}

  async send(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    await this.mailQueueService.enqueue({ to, subject, html });
  }

  /**
   * Convenience method for sending a verification code.
   *
   * @param locale - Request locale (e.g. `zh-CN` / `en`); defaults to `en`.
   */
  async sendVerificationCode(
    email: string,
    code: string,
    locale?: string,
  ): Promise<void> {
    const html = renderVerificationCodeEmail(code, 5, locale);
    await this.send(email, verificationCodeSubject(locale), html);
  }

  /**
   * Sends a one-time email-verification link (Better Auth token lifecycle).
   *
   * @param locale - Request locale (e.g. `zh-CN` / `en`); defaults to `en`.
   */
  async sendVerificationLink(
    email: string,
    url: string,
    locale?: string,
  ): Promise<void> {
    const html = renderVerificationLinkEmail(url, 60, locale);
    await this.send(email, verificationLinkSubject(locale), html);
  }
}
