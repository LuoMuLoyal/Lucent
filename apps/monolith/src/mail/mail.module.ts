import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { mailConfig } from '../config/services/mail.config.js';
import { MailQueueService } from './mail-queue.service.js';
import { MailService } from './mail.service.js';
import { MailTransportService } from './mail-transport.service.js';

@Global()
@Module({
  imports: [ConfigModule.forFeature(mailConfig)],
  providers: [MailTransportService, MailQueueService, MailService],
  exports: [MailService],
})
export class MailModule {}
