import { EnvKey } from './env-keys.enum';
import { NodeEnvironment, validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  it('applies local admin defaults outside production', () => {
    const config = validateEnvironment({
      [EnvKey.NODE_ENV]: NodeEnvironment.Development,
      [EnvKey.DATABASE_URL]:
        'postgresql://postgres:postgres@127.0.0.1:15432/lucent?schema=public',
    });

    expect(config[EnvKey.ADMIN_EMAIL]).toBe('admin@lucent.local');
    expect(config[EnvKey.ADMIN_PASSWORD]).toBe('admin12345');
    expect(config[EnvKey.ADMIN_COOKIE_SECRET]).toBe(
      'dev_lucent_admin_cookie_secret_32_chars',
    );
  });

  it('requires admin credentials in production', () => {
    expect(() =>
      validateEnvironment({
        [EnvKey.NODE_ENV]: NodeEnvironment.Production,
        [EnvKey.DATABASE_URL]:
          'postgresql://lucent:lucent_dev@postgres:5432/lucent?schema=public',
        [EnvKey.REDIS_URL]: 'redis://redis:6379',
        [EnvKey.JWT_ACCESS_SECRET]: 'access-secret',
        [EnvKey.JWT_REFRESH_SECRET]: 'refresh-secret',
        [EnvKey.CORS_ORIGIN]: 'https://example.com',
      }),
    ).toThrow('ADMIN_EMAIL');
  });
});
