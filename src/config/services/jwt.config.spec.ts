import { EnvKey } from '../env/env-keys.enum';
import {
  DEFAULT_JWT_ACCESS_TTL_SECONDS,
  DEFAULT_JWT_REFRESH_TTL_SECONDS,
} from '../constants';
import { jwtConfig } from './jwt.config';

describe('jwtConfig', () => {
  const saved: Record<string, string | undefined> = {};
  const keysToClean = [
    EnvKey.JWT_ACCESS_SECRET,
    EnvKey.JWT_REFRESH_SECRET,
    EnvKey.JWT_ACCESS_TTL,
    EnvKey.JWT_REFRESH_TTL,
    EnvKey.JWT_ISSUER,
    EnvKey.JWT_AUDIENCE,
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
    return jwtConfig() as {
      accessSecret: string;
      refreshSecret: string;
      accessTtl: number;
      refreshTtl: number;
      issuer: string;
      audience: string;
    };
  }

  it('uses default TTLs when env vars are absent', () => {
    process.env[EnvKey.JWT_ACCESS_SECRET] = 'access-secret';
    process.env[EnvKey.JWT_REFRESH_SECRET] = 'refresh-secret';

    const config = callFactory();

    expect(config.accessTtl).toBe(DEFAULT_JWT_ACCESS_TTL_SECONDS);
    expect(config.refreshTtl).toBe(DEFAULT_JWT_REFRESH_TTL_SECONDS);
    expect(config.issuer).toBe('lucent-api');
    expect(config.audience).toBe('luminous-app');
  });

  it('parses human-friendly TTL strings (s/m/h/d)', () => {
    process.env[EnvKey.JWT_ACCESS_SECRET] = 'access-secret';
    process.env[EnvKey.JWT_REFRESH_SECRET] = 'refresh-secret';
    process.env[EnvKey.JWT_ACCESS_TTL] = '30s';
    process.env[EnvKey.JWT_REFRESH_TTL] = '14d';

    const config = callFactory();

    expect(config.accessTtl).toBe(30);
    expect(config.refreshTtl).toBe(14 * 86400);
  });

  it('parses minutes and hours correctly', () => {
    process.env[EnvKey.JWT_ACCESS_SECRET] = 'access-secret';
    process.env[EnvKey.JWT_REFRESH_SECRET] = 'refresh-secret';
    process.env[EnvKey.JWT_ACCESS_TTL] = '15m';
    process.env[EnvKey.JWT_REFRESH_TTL] = '2h';

    const config = callFactory();

    expect(config.accessTtl).toBe(15 * 60);
    expect(config.refreshTtl).toBe(2 * 3600);
  });

  it('falls back to default when TTL value is unparseable', () => {
    process.env[EnvKey.JWT_ACCESS_SECRET] = 'access-secret';
    process.env[EnvKey.JWT_REFRESH_SECRET] = 'refresh-secret';
    process.env[EnvKey.JWT_ACCESS_TTL] = 'not-a-number';

    const config = callFactory();

    expect(config.accessTtl).toBe(DEFAULT_JWT_ACCESS_TTL_SECONDS);
  });

  it('accepts a plain numeric string as TTL', () => {
    process.env[EnvKey.JWT_ACCESS_SECRET] = 'access-secret';
    process.env[EnvKey.JWT_REFRESH_SECRET] = 'refresh-secret';
    process.env[EnvKey.JWT_ACCESS_TTL] = '7200';

    const config = callFactory();

    expect(config.accessTtl).toBe(7200);
  });

  it('falls back to default when plain numeric string is zero or negative', () => {
    process.env[EnvKey.JWT_ACCESS_SECRET] = 'access-secret';
    process.env[EnvKey.JWT_REFRESH_SECRET] = 'refresh-secret';
    process.env[EnvKey.JWT_ACCESS_TTL] = '0';
    process.env[EnvKey.JWT_REFRESH_TTL] = '-5';

    const config = callFactory();

    expect(config.accessTtl).toBe(DEFAULT_JWT_ACCESS_TTL_SECONDS);
    expect(config.refreshTtl).toBe(DEFAULT_JWT_REFRESH_TTL_SECONDS);
  });

  it('respects custom issuer and audience', () => {
    process.env[EnvKey.JWT_ACCESS_SECRET] = 'access-secret';
    process.env[EnvKey.JWT_REFRESH_SECRET] = 'refresh-secret';
    process.env[EnvKey.JWT_ISSUER] = 'my-issuer';
    process.env[EnvKey.JWT_AUDIENCE] = 'my-app';

    const config = callFactory();

    expect(config.issuer).toBe('my-issuer');
    expect(config.audience).toBe('my-app');
  });

  it('is case-insensitive for TTL unit suffix', () => {
    process.env[EnvKey.JWT_ACCESS_SECRET] = 'access-secret';
    process.env[EnvKey.JWT_REFRESH_SECRET] = 'refresh-secret';
    process.env[EnvKey.JWT_ACCESS_TTL] = '10M';
    process.env[EnvKey.JWT_REFRESH_TTL] = '3D';

    const config = callFactory();

    expect(config.accessTtl).toBe(10 * 60);
    expect(config.refreshTtl).toBe(3 * 86400);
  });
});
