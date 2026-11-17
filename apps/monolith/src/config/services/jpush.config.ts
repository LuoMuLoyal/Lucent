import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';

export interface JpushConfig {
  appKey: string;
  masterSecret: string;
  apnsProduction: boolean;
  apiBaseUrl: string;
}

export const jpushConfig = registerAs(ConfigKey.Jpush, (): JpushConfig => {
  return {
    // Sensitive — from .env
    appKey: (process.env[EnvKey.JPUSH_APP_KEY] ?? '').trim(),
    masterSecret: (process.env[EnvKey.JPUSH_MASTER_SECRET] ?? '').trim(),
    apnsProduction: process.env[EnvKey.JPUSH_APNS_PRODUCTION] === 'true',
    apiBaseUrl: (process.env[EnvKey.JPUSH_API_BASE_URL] ?? '').trim(),
  };
});
