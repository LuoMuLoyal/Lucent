import { registerAs } from '@nestjs/config';
import { ConfigKey } from './config-keys.enum';
import { EnvKey } from './env-keys.enum';

function parseCorsOrigin(raw: string): boolean | string[] {
  const value = raw.trim();
  if (!value) {
    return false;
  }

  if (value === '*') {
    return true;
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const appConfig = registerAs(ConfigKey.App, () => ({
  env: process.env[EnvKey.NODE_ENV] ?? 'development',
  host: process.env[EnvKey.HOST] ?? '0.0.0.0',
  port: Number(process.env[EnvKey.PORT] ?? 3000),
  corsOrigin: parseCorsOrigin(process.env[EnvKey.CORS_ORIGIN] ?? ''),
  trustProxy: process.env[EnvKey.TRUST_PROXY] === 'true',
}));
