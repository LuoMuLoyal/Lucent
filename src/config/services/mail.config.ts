import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';

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

export const mailConfig = registerAs(ConfigKey.Mail, (): MailConfig => {
  return {
    driver: process.env[EnvKey.MAIL_DRIVER] as MailDriver,
    host: process.env[EnvKey.MAIL_HOST] ?? '',
    port: Number(process.env[EnvKey.MAIL_PORT]),
    user: process.env[EnvKey.MAIL_USER] ?? '',
    pass: process.env[EnvKey.MAIL_PASS] ?? '',
    from: process.env[EnvKey.MAIL_FROM] ?? '',
    queue: {
      maxAttempts: Number(process.env[EnvKey.MAIL_QUEUE_MAX_ATTEMPTS]),
      backoffDelayMs: Number(process.env[EnvKey.MAIL_QUEUE_BACKOFF_DELAY_MS]),
      workerConcurrency: Number(
        process.env[EnvKey.MAIL_QUEUE_WORKER_CONCURRENCY],
      ),
      completeAgeSeconds: Number(
        process.env[EnvKey.MAIL_QUEUE_COMPLETE_AGE_SECONDS],
      ),
      failAgeSeconds: Number(process.env[EnvKey.MAIL_QUEUE_FAIL_AGE_SECONDS]),
      completeMaxCount: Number(
        process.env[EnvKey.MAIL_QUEUE_COMPLETE_MAX_COUNT],
      ),
      failMaxCount: Number(process.env[EnvKey.MAIL_QUEUE_FAIL_MAX_COUNT]),
    },
  };
});
