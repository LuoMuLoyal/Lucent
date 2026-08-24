import { registerAs } from '@nestjs/config';
import { ConfigKey } from './env/config-keys.enum';
import { EnvKey } from './env/env-keys.enum';
import { loadYamlConfig } from './yaml/yaml-loader';

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

export const appConfig = registerAs(ConfigKey.App, () => {
  const yaml = loadYamlConfig();
  const env = process.env[EnvKey.NODE_ENV] ?? 'development';
  const isProduction = env === 'production';

  // Sensitive values (metrics credentials) stay in .env / process.env.
  // Non-sensitive runtime params come from YAML, overridable by env vars.
  const envHost = process.env[EnvKey.HOST];
  const envPort = process.env[EnvKey.PORT];
  const envCorsOrigin = process.env[EnvKey.CORS_ORIGIN];
  const envPublicBaseUrl = process.env[EnvKey.PUBLIC_BASE_URL];

  return {
    env,
    host: envHost ?? (isProduction ? '127.0.0.1' : yaml.app.host),
    port: Number(envPort ?? yaml.app.port),
    corsOrigin: parseCorsOrigin(envCorsOrigin ?? yaml.app.corsOrigin),
    trustProxy: process.env[EnvKey.TRUST_PROXY] === 'true',
    metricsUser: process.env[EnvKey.METRICS_USER]?.trim() || undefined,
    metricsPassword: process.env[EnvKey.METRICS_PASSWORD]?.trim() || undefined,
    publicBaseUrl: envPublicBaseUrl?.trim() || yaml.app.publicBaseUrl,
  };
});
