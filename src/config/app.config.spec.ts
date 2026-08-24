import { EnvKey } from './env/env-keys.enum';
import { appConfig } from './app.config';

describe('appConfig', () => {
  const saved: Record<string, string | undefined> = {};
  const keysToClean = [
    EnvKey.NODE_ENV,
    EnvKey.HOST,
    EnvKey.PORT,
    EnvKey.CORS_ORIGIN,
    EnvKey.TRUST_PROXY,
    EnvKey.PUBLIC_BASE_URL,
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
    return appConfig() as {
      env: string;
      host: string;
      port: number;
      corsOrigin: boolean | string[];
      trustProxy: boolean;
      publicBaseUrl: string;
    };
  }

  it('defaults to development with 0.0.0.0 host when NODE_ENV is absent', () => {
    const config = callFactory();

    expect(config.env).toBe('development');
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(3000);
    // development.yaml overrides corsOrigin to localhost origins
    expect(config.corsOrigin).toEqual([
      'http://localhost:3000',
      'http://localhost:8080',
    ]);
    expect(config.trustProxy).toBe(false);
    expect(config.publicBaseUrl).toBe('http://localhost:3000');
  });

  it('uses 127.0.0.1 as default host in production', () => {
    process.env[EnvKey.NODE_ENV] = 'production';

    const config = callFactory();

    expect(config.host).toBe('127.0.0.1');
  });

  it('parses CORS origin "*" as true (allow-all)', () => {
    process.env[EnvKey.CORS_ORIGIN] = '*';

    const config = callFactory();

    expect(config.corsOrigin).toBe(true);
  });

  it('parses comma-separated CORS origins into an array', () => {
    process.env[EnvKey.CORS_ORIGIN] =
      'https://app.example.com, https://admin.example.com';

    const config = callFactory();

    expect(config.corsOrigin).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('returns false for empty CORS origin', () => {
    process.env[EnvKey.CORS_ORIGIN] = '   ';

    const config = callFactory();

    expect(config.corsOrigin).toBe(false);
  });

  it('filters out empty entries in CORS origin list', () => {
    process.env[EnvKey.CORS_ORIGIN] = 'https://a.com, , https://b.com';

    const config = callFactory();

    expect(config.corsOrigin).toEqual(['https://a.com', 'https://b.com']);
  });

  it('respects custom host and port', () => {
    process.env[EnvKey.HOST] = '10.0.0.1';
    process.env[EnvKey.PORT] = '8080';

    const config = callFactory();

    expect(config.host).toBe('10.0.0.1');
    expect(config.port).toBe(8080);
  });

  it('defaults trustProxy to false in test environment', () => {
    process.env[EnvKey.NODE_ENV] = 'test';

    const config = callFactory();

    expect(config.trustProxy).toBe(false);
  });

  it('enables trustProxy when TRUST_PROXY is true', () => {
    process.env[EnvKey.TRUST_PROXY] = 'true';

    const config = callFactory();

    expect(config.trustProxy).toBe(true);
  });

  it('uses custom publicBaseUrl when provided', () => {
    process.env[EnvKey.PUBLIC_BASE_URL] = '  https://api.lumos.example.com  ';

    const config = callFactory();

    expect(config.publicBaseUrl).toBe('https://api.lumos.example.com');
  });
});
