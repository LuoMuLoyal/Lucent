import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { mailConfig } from '../config/mail.config';
import { MailQueueService } from './mail-queue.service';
import { MailService } from './mail.service';
import { MailTransportService } from './mail-transport.service';

@Global()
@Module({
  imports: [ConfigModule.forFeature(mailConfig)],
  providers: [MailTransportService, MailQueueService, MailService],
  exports: [MailService],
})
export class MailModule {}
