import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { mailConfig } from '../config/mail.config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(
    @Inject(mailConfig.KEY)
    private readonly config: ConfigType<typeof mailConfig>,
  ) {
    if (this.config.driver === 'smtp') {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.port === 465,
        auth: {
          user: this.config.user,
          pass: this.config.pass,
        },
      });
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (this.config.driver === 'log') {
      this.logger.log(`📧 [MAIL] To: ${to} | Subject: ${subject}`);
      this.logger.log(`📧 [MAIL] Body: ${html}`);
      return;
    }

    if (!this.transporter) {
      throw new Error('Mail transporter not initialized');
    }

    await this.transporter.sendMail({
      from: this.config.from,
      to,
      subject,
      html,
    });

    this.logger.log(`Email sent to ${to} (subject: ${subject})`);
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
