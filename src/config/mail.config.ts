import { registerAs } from '@nestjs/config';
import { ConfigKey } from './config-keys.enum';
import { EnvKey } from './env-keys.enum';

export type MailDriver = 'log' | 'smtp';

export interface MailConfig {
  driver: MailDriver;
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
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
  }),
);
