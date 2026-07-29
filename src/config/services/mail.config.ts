import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum';
import { EnvKey } from '../env/env-keys.enum';
import {
  DEFAULT_MAIL_QUEUE_BACKOFF_DELAY_MS,
  DEFAULT_MAIL_QUEUE_COMPLETE_AGE_SECONDS,
  DEFAULT_MAIL_QUEUE_COMPLETE_MAX_COUNT,
  DEFAULT_MAIL_QUEUE_FAIL_AGE_SECONDS,
  DEFAULT_MAIL_QUEUE_FAIL_MAX_COUNT,
  DEFAULT_MAIL_QUEUE_MAX_ATTEMPTS,
  DEFAULT_MAIL_QUEUE_WORKER_CONCURRENCY,
} from '../constants';

export type MailDriver = 'log' | 'smtp';

export interface MailConfig {
  driver: MailDriver;
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  queue: {
    maxAttempts: number;
    backoffDelayMs: number;
    workerConcurrency: number;
    completeAgeSeconds: number;
    failAgeSeconds: number;
    completeMaxCount: number;
    failMaxCount: number;
  };
}

export const mailConfig = registerAs(
  ConfigKey.Mail,
  (): MailConfig => ({
    driver: (process.env[EnvKey.MAIL_DRIVER] ?? 'log') as MailDriver,
    host: process.env[EnvKey.MAIL_HOST] ?? '',
    port: Number(process.env[EnvKey.MAIL_PORT] ?? 587),
    user: process.env[EnvKey.MAIL_USER] ?? '',
    pass: process.env[EnvKey.MAIL_PASS] ?? '',
    from: process.env[EnvKey.MAIL_FROM] ?? 'noreply@example.com',
    queue: {
      maxAttempts: Number(
        process.env[EnvKey.MAIL_QUEUE_MAX_ATTEMPTS] ??
          DEFAULT_MAIL_QUEUE_MAX_ATTEMPTS,
      ),
      backoffDelayMs: Number(
        process.env[EnvKey.MAIL_QUEUE_BACKOFF_DELAY_MS] ??
          DEFAULT_MAIL_QUEUE_BACKOFF_DELAY_MS,
      ),
      workerConcurrency: Number(
        process.env[EnvKey.MAIL_QUEUE_WORKER_CONCURRENCY] ??
          DEFAULT_MAIL_QUEUE_WORKER_CONCURRENCY,
      ),
      completeAgeSeconds: Number(
        process.env[EnvKey.MAIL_QUEUE_COMPLETE_AGE_SECONDS] ??
          DEFAULT_MAIL_QUEUE_COMPLETE_AGE_SECONDS,
      ),
      failAgeSeconds: Number(
        process.env[EnvKey.MAIL_QUEUE_FAIL_AGE_SECONDS] ??
          DEFAULT_MAIL_QUEUE_FAIL_AGE_SECONDS,
      ),
      completeMaxCount: Number(
        process.env[EnvKey.MAIL_QUEUE_COMPLETE_MAX_COUNT] ??
          DEFAULT_MAIL_QUEUE_COMPLETE_MAX_COUNT,
      ),
      failMaxCount: Number(
        process.env[EnvKey.MAIL_QUEUE_FAIL_MAX_COUNT] ??
          DEFAULT_MAIL_QUEUE_FAIL_MAX_COUNT,
      ),
    },
  }),
);
