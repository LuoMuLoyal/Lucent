import { EnvKey } from './env-keys.enum';
import {
  DEFAULT_MAIL_QUEUE_BACKOFF_DELAY_MS,
  DEFAULT_MAIL_QUEUE_COMPLETE_AGE_SECONDS,
  DEFAULT_MAIL_QUEUE_COMPLETE_MAX_COUNT,
  DEFAULT_MAIL_QUEUE_FAIL_AGE_SECONDS,
  DEFAULT_MAIL_QUEUE_FAIL_MAX_COUNT,
  DEFAULT_MAIL_QUEUE_MAX_ATTEMPTS,
  DEFAULT_MAIL_QUEUE_WORKER_CONCURRENCY,
} from './constants';
import { mailConfig } from './mail.config';

describe('mailConfig', () => {
  const saved: Record<string, string | undefined> = {};
  const keysToClean = [
    EnvKey.MAIL_DRIVER,
    EnvKey.MAIL_HOST,
    EnvKey.MAIL_PORT,
    EnvKey.MAIL_USER,
    EnvKey.MAIL_PASS,
    EnvKey.MAIL_FROM,
    EnvKey.MAIL_QUEUE_MAX_ATTEMPTS,
    EnvKey.MAIL_QUEUE_BACKOFF_DELAY_MS,
    EnvKey.MAIL_QUEUE_WORKER_CONCURRENCY,
    EnvKey.MAIL_QUEUE_COMPLETE_AGE_SECONDS,
    EnvKey.MAIL_QUEUE_FAIL_AGE_SECONDS,
    EnvKey.MAIL_QUEUE_COMPLETE_MAX_COUNT,
    EnvKey.MAIL_QUEUE_FAIL_MAX_COUNT,
  ];

  beforeEach(() => {
    for (const key of keysToClean) {
      saved[key] = process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    for (const key of keysToClean) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      } else {
        Reflect.deleteProperty(process.env, key);
      }
    }
  });

  function callFactory() {
    return mailConfig()!;
  }

  it('uses log driver and empty SMTP fields when env vars are absent', () => {
    const config = callFactory();

    expect(config.driver).toBe('log');
    expect(config.host).toBe('');
    expect(config.port).toBe(587);
    expect(config.user).toBe('');
    expect(config.pass).toBe('');
    expect(config.from).toBe('noreply@example.com');
  });

  it('reads SMTP connection fields from env vars', () => {
    process.env[EnvKey.MAIL_DRIVER] = 'smtp';
    process.env[EnvKey.MAIL_HOST] = 'smtp.example.com';
    process.env[EnvKey.MAIL_PORT] = '465';
    process.env[EnvKey.MAIL_USER] = 'postmaster';
    process.env[EnvKey.MAIL_PASS] = 'secret-pass';
    process.env[EnvKey.MAIL_FROM] = 'no-reply@example.com';

    const config = callFactory();

    expect(config.driver).toBe('smtp');
    expect(config.host).toBe('smtp.example.com');
    expect(config.port).toBe(465);
    expect(config.user).toBe('postmaster');
    expect(config.pass).toBe('secret-pass');
    expect(config.from).toBe('no-reply@example.com');
  });

  it('uses default queue settings when env vars are absent', () => {
    const config = callFactory();

    expect(config.queue.maxAttempts).toBe(DEFAULT_MAIL_QUEUE_MAX_ATTEMPTS);
    expect(config.queue.backoffDelayMs).toBe(
      DEFAULT_MAIL_QUEUE_BACKOFF_DELAY_MS,
    );
    expect(config.queue.workerConcurrency).toBe(
      DEFAULT_MAIL_QUEUE_WORKER_CONCURRENCY,
    );
    expect(config.queue.completeAgeSeconds).toBe(
      DEFAULT_MAIL_QUEUE_COMPLETE_AGE_SECONDS,
    );
    expect(config.queue.failAgeSeconds).toBe(
      DEFAULT_MAIL_QUEUE_FAIL_AGE_SECONDS,
    );
    expect(config.queue.completeMaxCount).toBe(
      DEFAULT_MAIL_QUEUE_COMPLETE_MAX_COUNT,
    );
    expect(config.queue.failMaxCount).toBe(DEFAULT_MAIL_QUEUE_FAIL_MAX_COUNT);
  });

  it('parses custom queue settings from env vars', () => {
    process.env[EnvKey.MAIL_QUEUE_MAX_ATTEMPTS] = '5';
    process.env[EnvKey.MAIL_QUEUE_BACKOFF_DELAY_MS] = '10000';
    process.env[EnvKey.MAIL_QUEUE_WORKER_CONCURRENCY] = '1';
    process.env[EnvKey.MAIL_QUEUE_COMPLETE_AGE_SECONDS] = '3600';
    process.env[EnvKey.MAIL_QUEUE_FAIL_AGE_SECONDS] = '7200';
    process.env[EnvKey.MAIL_QUEUE_COMPLETE_MAX_COUNT] = '500';
    process.env[EnvKey.MAIL_QUEUE_FAIL_MAX_COUNT] = '1000';

    const config = callFactory();

    expect(config.queue.maxAttempts).toBe(5);
    expect(config.queue.backoffDelayMs).toBe(10_000);
    expect(config.queue.workerConcurrency).toBe(1);
    expect(config.queue.completeAgeSeconds).toBe(3600);
    expect(config.queue.failAgeSeconds).toBe(7200);
    expect(config.queue.completeMaxCount).toBe(500);
    expect(config.queue.failMaxCount).toBe(1000);
  });
});
