import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobsOptions, Queue } from 'bullmq';
import { BullmqQueueFactory } from '../common/queue/queue.factory.js';
import { QUEUE_NAMES } from '../common/queue/queue-names.js';
import { ConfigKey } from '../config/env/config-keys.enum.js';
import { EnvKey } from '../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../config/runtime/runtime-config.types.js';
import type { MailConfig } from '../config/services/mail.config.js';
import { MailTransportService } from './mail-transport.service.js';

const MAIL_QUEUE_NAME = QUEUE_NAMES.mail;
const SEND_MAIL_JOB = 'send-mail';

/** Snapshot keys that shape one mail job's retry and retention policy. */
type MailQueuePolicyKey =
  | typeof EnvKey.MAIL_QUEUE_MAX_ATTEMPTS
  | typeof EnvKey.MAIL_QUEUE_BACKOFF_DELAY_MS
  | typeof EnvKey.MAIL_QUEUE_COMPLETE_AGE_SECONDS
  | typeof EnvKey.MAIL_QUEUE_COMPLETE_MAX_COUNT
  | typeof EnvKey.MAIL_QUEUE_FAIL_AGE_SECONDS
  | typeof EnvKey.MAIL_QUEUE_FAIL_MAX_COUNT;

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
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {
    const handle = factory.createQueue<SendMailJobData>({
      name: MAIL_QUEUE_NAME,
      runtimeKey: MAIL_QUEUE_NAME,
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
      // 重试与保留策略在**入队时**取快照：已入队的任务保留它们入队时的值，
      // 新任务是唯一会读到新发布值的对象。
      await this.queue.add(SEND_MAIL_JOB, message, this.jobOptions());
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

  private jobOptions(): JobsOptions {
    const values = this.runtimeConfig?.getSnapshot().values;
    const q = this.configService.get<MailConfig>(ConfigKey.Mail)?.queue;
    const number = (
      key: MailQueuePolicyKey,
      fallback: number | undefined,
    ): number => {
      const value = values?.[key];
      return typeof value === 'number' ? value : (fallback ?? 0);
    };
    return {
      attempts: number(EnvKey.MAIL_QUEUE_MAX_ATTEMPTS, q?.maxAttempts) || 3,
      backoff: {
        type: 'exponential',
        delay:
          number(EnvKey.MAIL_QUEUE_BACKOFF_DELAY_MS, q?.backoffDelayMs) ||
          5_000,
      },
      removeOnComplete: {
        age:
          number(
            EnvKey.MAIL_QUEUE_COMPLETE_AGE_SECONDS,
            q?.completeAgeSeconds,
          ) || 24 * 60 * 60,
        count:
          number(EnvKey.MAIL_QUEUE_COMPLETE_MAX_COUNT, q?.completeMaxCount) ||
          1_000,
      },
      removeOnFail: {
        age:
          number(EnvKey.MAIL_QUEUE_FAIL_AGE_SECONDS, q?.failAgeSeconds) ||
          7 * 24 * 60 * 60,
        count:
          number(EnvKey.MAIL_QUEUE_FAIL_MAX_COUNT, q?.failMaxCount) || 5_000,
      },
    };
  }
}
