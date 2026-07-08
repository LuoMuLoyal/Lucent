import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions, JobsOptions, Job } from 'bullmq';

import { EnvKey } from '../config/env-keys.enum';
import { MailTransportService } from './mail-transport.service';

const MAIL_QUEUE_NAME = 'lucent-mail';
const SEND_MAIL_JOB = 'send-mail';

// ── Mail queue tuning constants ───────────────────────────────────────────────

/** Maximum send attempts per mail job. */
const MAIL_MAX_ATTEMPTS = 3;

/** Initial backoff delay in ms for exponential retry. */
const MAIL_BACKOFF_DELAY_MS = 5_000;

/** Worker concurrency (parallel job processing). */
const MAIL_WORKER_CONCURRENCY = 3;

/** Age in seconds after which completed jobs are removed (24 h). */
const MAIL_COMPLETE_AGE_SECONDS = 24 * 60 * 60;

/** Age in seconds after which failed jobs are removed (7 d). */
const MAIL_FAIL_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Maximum number of completed jobs to retain. */
const MAIL_COMPLETE_MAX_COUNT = 1_000;

/** Maximum number of failed jobs to retain. */
const MAIL_FAIL_MAX_COUNT = 5_000;

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
        defaultJobOptions: this.defaultJobOptions(),
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
        concurrency: MAIL_WORKER_CONCURRENCY,
        removeOnComplete: {
          age: MAIL_COMPLETE_AGE_SECONDS,
          count: MAIL_COMPLETE_MAX_COUNT,
        },
        removeOnFail: {
          age: MAIL_FAIL_AGE_SECONDS,
          count: MAIL_FAIL_MAX_COUNT,
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

  private defaultJobOptions(): JobsOptions {
    return {
      attempts: MAIL_MAX_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: MAIL_BACKOFF_DELAY_MS,
      },
      removeOnComplete: {
        age: MAIL_COMPLETE_AGE_SECONDS,
        count: MAIL_COMPLETE_MAX_COUNT,
      },
      removeOnFail: { age: MAIL_FAIL_AGE_SECONDS, count: MAIL_FAIL_MAX_COUNT },
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
