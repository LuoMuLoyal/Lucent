import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';
import { loadYamlConfig } from '../yaml/yaml-loader.js';

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
  const yaml = loadYamlConfig();
  const mail = yaml.mail;

  return {
    driver: (process.env[EnvKey.MAIL_DRIVER] ?? mail.driver) as MailDriver,
    host: process.env[EnvKey.MAIL_HOST] ?? mail.host,
    port: Number(process.env[EnvKey.MAIL_PORT] ?? mail.port),
    // Sensitive — from .env
    user: process.env[EnvKey.MAIL_USER] ?? '',
    pass: process.env[EnvKey.MAIL_PASS] ?? '',
    from: process.env[EnvKey.MAIL_FROM] ?? mail.from,
    queue: {
      maxAttempts: Number(
        process.env[EnvKey.MAIL_QUEUE_MAX_ATTEMPTS] ?? mail.queue.maxAttempts,
      ),
      backoffDelayMs: Number(
        process.env[EnvKey.MAIL_QUEUE_BACKOFF_DELAY_MS] ??
          mail.queue.backoffDelayMs,
      ),
      workerConcurrency: Number(
        process.env[EnvKey.MAIL_QUEUE_WORKER_CONCURRENCY] ??
          mail.queue.workerConcurrency,
      ),
      completeAgeSeconds: Number(
        process.env[EnvKey.MAIL_QUEUE_COMPLETE_AGE_SECONDS] ??
          mail.queue.completeAgeSeconds,
      ),
      failAgeSeconds: Number(
        process.env[EnvKey.MAIL_QUEUE_FAIL_AGE_SECONDS] ??
          mail.queue.failAgeSeconds,
      ),
      completeMaxCount: Number(
        process.env[EnvKey.MAIL_QUEUE_COMPLETE_MAX_COUNT] ??
          mail.queue.completeMaxCount,
      ),
      failMaxCount: Number(
        process.env[EnvKey.MAIL_QUEUE_FAIL_MAX_COUNT] ??
          mail.queue.failMaxCount,
      ),
    },
  };
});
