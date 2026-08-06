import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum';
import { EnvKey } from '../env/env-keys.enum';

export const DEFAULT_JPUSH_API_BASE_URL = 'https://api.jpush.cn';

export interface JpushConfig {
  appKey: string;
  masterSecret: string;
  apnsProduction: boolean;
  apiBaseUrl: string;
}

export const jpushConfig = registerAs(
  ConfigKey.Jpush,
  (): JpushConfig => ({
    appKey: (process.env[EnvKey.JPUSH_APP_KEY] ?? '').trim(),
    masterSecret: (process.env[EnvKey.JPUSH_MASTER_SECRET] ?? '').trim(),
    apnsProduction:
      process.env[EnvKey.JPUSH_APNS_PRODUCTION]?.trim() === 'true',
    apiBaseUrl:
      (process.env[EnvKey.JPUSH_API_BASE_URL] ?? '').trim() ||
      DEFAULT_JPUSH_API_BASE_URL,
  }),
);
