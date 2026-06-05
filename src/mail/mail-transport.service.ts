import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { mailConfig } from '../config/mail.config';

@Injectable()
export class MailTransportService {
  private readonly logger = new Logger(MailTransportService.name);
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
      this.logger.log(`[MAIL] To: ${to} | Subject: ${subject}`);
      this.logger.log(`[MAIL] Body: ${html}`);
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
}
