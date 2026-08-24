import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum';
import { EnvKey } from '../env/env-keys.enum';
import { loadYamlConfig } from '../yaml/yaml-loader';

/** Default JPush REST API base URL (mirrors config/default.yaml). */
export const DEFAULT_JPUSH_API_BASE_URL = 'https://api.jpush.cn';

export interface JpushConfig {
  appKey: string;
  masterSecret: string;
  apnsProduction: boolean;
  apiBaseUrl: string;
}

export const jpushConfig = registerAs(ConfigKey.Jpush, (): JpushConfig => {
  const yaml = loadYamlConfig();

  return {
    // Sensitive — from .env
    appKey: (process.env[EnvKey.JPUSH_APP_KEY] ?? '').trim(),
    masterSecret: (process.env[EnvKey.JPUSH_MASTER_SECRET] ?? '').trim(),
    // Non-sensitive — from YAML, overridable by env vars
    apnsProduction:
      process.env[EnvKey.JPUSH_APNS_PRODUCTION] != null
        ? process.env[EnvKey.JPUSH_APNS_PRODUCTION] === 'true'
        : yaml.jpush.apnsProduction,
    apiBaseUrl:
      (process.env[EnvKey.JPUSH_API_BASE_URL] ?? '').trim() ||
      yaml.jpush.apiBaseUrl,
  };
});
