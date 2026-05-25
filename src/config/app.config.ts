import { registerAs } from '@nestjs/config';

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

export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN ?? '*'),
}));
