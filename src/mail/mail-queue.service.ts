import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions, JobsOptions, Job } from 'bullmq';

import { ConfigKey } from '../config/config-keys.enum';
import type { MailConfig } from '../config/mail.config';
import { EnvKey } from '../config/env-keys.enum';
import { MailTransportService } from './mail-transport.service';

const MAIL_QUEUE_NAME = 'lucent-mail';
const SEND_MAIL_JOB = 'send-mail';

interface SendMailJobData {
  to: string;
  subject: string;
  html: string;
}

type SendMailJobName = typeof SEND_MAIL_JOB;

interface RedisRetryOptions {
  maxRetriesPerRequest: number | null;
}

@Injectable()
export class MailQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailQueueService.name);
  private queue: Queue<SendMailJobData, void, SendMailJobName> | null = null;
  private worker: Worker<SendMailJobData, void, SendMailJobName> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly transport: MailTransportService,
  ) {}

  onModuleInit(): void {
    const redisUrl = this.configService.get<string>(EnvKey.REDIS_URL);
    if (!redisUrl) {
      this.logger.log('Mail queue disabled; REDIS_URL is not configured');
      return;
    }

    const mailConfig = this.configService.get<MailConfig>(ConfigKey.Mail);
    const queueConfig = mailConfig?.queue;

    const queueConnection = this.createConnection(redisUrl, {
      maxRetriesPerRequest: 1,
    });
    const workerConnection = this.createConnection(redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue<SendMailJobData, void, SendMailJobName>(
      MAIL_QUEUE_NAME,
      {
        connection: queueConnection,
        defaultJobOptions: this.defaultJobOptions(queueConfig),
      },
    );
    this.queue.on('error', (error) => {
      this.logger.error(`Mail queue error: ${error.message}`, error.stack);
    });

    this.worker = new Worker<SendMailJobData, void, SendMailJobName>(
      MAIL_QUEUE_NAME,
      (job) => this.processJob(job),
      {
        connection: workerConnection,
        concurrency: queueConfig?.workerConcurrency ?? 3,
        removeOnComplete: {
          age: queueConfig?.completeAgeSeconds ?? 24 * 60 * 60,
          count: queueConfig?.completeMaxCount ?? 1_000,
        },
        removeOnFail: {
          age: queueConfig?.failAgeSeconds ?? 7 * 24 * 60 * 60,
          count: queueConfig?.failMaxCount ?? 5_000,
        },
      },
    );
    this.worker.on('failed', (job, error) => {
      const jobId = job?.id ?? 'unknown';
      this.logger.error(`Mail job failed: id=${jobId}`, error.stack);
    });
    this.worker.on('error', (error) => {
      this.logger.error(`Mail worker error: ${error.message}`, error.stack);
    });

    this.logger.log(`Mail queue enabled: ${MAIL_QUEUE_NAME}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueue(message: SendMailJobData): Promise<void> {
    if (!this.queue) {
      await this.transport.send(message.to, message.subject, message.html);
      return;
    }

    await this.queue.add(SEND_MAIL_JOB, message);
  }

  private async processJob(
    job: Job<SendMailJobData, void, SendMailJobName>,
  ): Promise<void> {
    await this.transport.send(job.data.to, job.data.subject, job.data.html);
  }

  private defaultJobOptions(
    config: MailConfig['queue'] | undefined,
  ): JobsOptions {
    return {
      attempts: config?.maxAttempts ?? 3,
      backoff: {
        type: 'exponential',
        delay: config?.backoffDelayMs ?? 5_000,
      },
      removeOnComplete: {
        age: config?.completeAgeSeconds ?? 24 * 60 * 60,
        count: config?.completeMaxCount ?? 1_000,
      },
      removeOnFail: {
        age: config?.failAgeSeconds ?? 7 * 24 * 60 * 60,
        count: config?.failMaxCount ?? 5_000,
      },
    };
  }

  private createConnection(
    redisUrl: string,
    retryOptions: RedisRetryOptions,
  ): ConnectionOptions {
    const url = new URL(redisUrl);
    const database = url.pathname ? Number(url.pathname.slice(1)) || 0 : 0;

    return {
      host: url.hostname,
      port: Number(url.port) || 6379,
      db: database,
      ...(url.username ? { username: url.username } : {}),
      ...(url.password ? { password: url.password } : {}),
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
      ...retryOptions,
    };
  }
}
