import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobsOptions, Queue } from 'bullmq';
import { BullmqQueueFactory } from '../common/queue/queue.factory.js';
import { ConfigKey } from '../config/env/config-keys.enum.js';
import type { MailConfig } from '../config/services/mail.config.js';
import { MailTransportService } from './mail-transport.service.js';

const MAIL_QUEUE_NAME = 'lucent-mail';
const SEND_MAIL_JOB = 'send-mail';

interface SendMailJobData {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class MailQueueService {
  private readonly logger = new Logger(MailQueueService.name);
  private readonly queue: Queue<SendMailJobData, void> | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly transport: MailTransportService,
    factory: BullmqQueueFactory,
  ) {
    const handle = factory.createQueue<SendMailJobData>({
      name: MAIL_QUEUE_NAME,
      defaultJobOptions: this.defaultJobOptions(),
      workerConcurrency: this.workerConcurrency(),
      processor: async (job) => {
        await this.transport.send(job.data.to, job.data.subject, job.data.html);
      },
    });
    this.queue = handle.queue;
  }

  async enqueue(message: SendMailJobData): Promise<void> {
    if (!this.queue) {
      await this.transport.send(message.to, message.subject, message.html);
      return;
    }

    try {
      await this.queue.add(SEND_MAIL_JOB, message);
    } catch (error) {
      // Redis 配置但断连时回退到同步发送，避免请求直接 500。
      this.logger.error(
        `Failed to enqueue mail, sending synchronously: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.transport.send(message.to, message.subject, message.html);
    }
  }

  private defaultJobOptions(): JobsOptions {
    const mailConfig = this.configService.get<MailConfig>(ConfigKey.Mail);
    const q = mailConfig?.queue;
    return {
      attempts: q?.maxAttempts ?? 3,
      backoff: {
        type: 'exponential',
        delay: q?.backoffDelayMs ?? 5_000,
      },
      removeOnComplete: {
        age: q?.completeAgeSeconds ?? 24 * 60 * 60,
        count: q?.completeMaxCount ?? 1_000,
      },
      removeOnFail: {
        age: q?.failAgeSeconds ?? 7 * 24 * 60 * 60,
        count: q?.failMaxCount ?? 5_000,
      },
    };
  }

  private workerConcurrency(): number {
    const mailConfig = this.configService.get<MailConfig>(ConfigKey.Mail);
    const q = mailConfig?.queue;
    return q?.workerConcurrency ?? 3;
  }
}
