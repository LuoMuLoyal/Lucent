import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum';
import { EnvKey } from '../env/env-keys.enum';
import { loadYamlConfig } from '../yaml/yaml-loader';

/**
 * Parse a human-friendly TTL string (e.g. "15m", "14d", "2h") into seconds.
 * Falls back to `defaultSeconds` when the value is missing or unparseable.
 */
function parseTtl(raw: string | undefined, defaultSeconds: number): number {
  if (!raw) {
    return defaultSeconds;
  }

  const match = raw.match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) {
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : defaultSeconds;
  }

  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase() as 's' | 'm' | 'h' | 'd';

  const multipliers: Record<'s' | 'm' | 'h' | 'd', number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };

  return value * multipliers[unit];
}

export const jwtConfig = registerAs(ConfigKey.Jwt, () => {
  const yaml = loadYamlConfig();

  return {
    accessSecret: process.env[EnvKey.JWT_ACCESS_SECRET] as string,
    refreshSecret: process.env[EnvKey.JWT_REFRESH_SECRET] as string,
    accessTtl: parseTtl(process.env[EnvKey.JWT_ACCESS_TTL], yaml.jwt.accessTtl),
    refreshTtl: parseTtl(
      process.env[EnvKey.JWT_REFRESH_TTL],
      yaml.jwt.refreshTtl,
    ),
    issuer: process.env[EnvKey.JWT_ISSUER] ?? 'lucent-api',
    audience: process.env[EnvKey.JWT_AUDIENCE] ?? 'luminous-app',
  };
});
