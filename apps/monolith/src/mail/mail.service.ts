import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { MailQueueService } from './mail-queue.service.js';
import {
  renderVerificationCodeEmail,
  verificationCodeSubject,
} from './templates.js';

/**
 * Queues outbound emails via the configured mail queue.
 *
 * Emails are rendered in the request locale (passed as an ISO locale string)
 * so they match the language the user is using in the product; English is the
 * fallback for unsupported locales.
 *
 * This service owns the `I18nService` dependency and hands it to the pure
 * template functions, which therefore need no DI of their own.
 */
@Injectable()
export class MailService {
  constructor(
    private readonly mailQueueService: MailQueueService,
    private readonly i18n: I18nService,
  ) {}

  async send(to: string, subject: string, html: string): Promise<void> {
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
    const html = renderVerificationCodeEmail(this.i18n, code, 5, locale);
    await this.send(email, verificationCodeSubject(this.i18n, locale), html);
  }
}
