import { EnvKey } from './env-keys.enum';
import { NodeEnvironment, validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  const localDatabaseUrl =
    'postgresql://postgres:postgres@127.0.0.1:15432/lucent?schema=public';
  const prodDatabaseUrl =
    'postgresql://lucent:lucent_dev@postgres:5432/lucent?schema=public';
  const redisUrl = 'redis://redis:6379';
  const localJwtAccessSecret = 'local-access-secret-min-32-characters-long';
  const localJwtRefreshSecret = 'local-refresh-secret-min-32-characters-long';
  const prodJwtAccessSecret = 'prod-access-secret-min-32-characters-long';
  const prodJwtRefreshSecret = 'prod-refresh-secret-min-32-characters-long';
  const adminEmail = 'admin@example.com';
  const adminPassword = 'admin12345';
  const adminCookieSecret = 'dev_lucent_admin_cookie_secret_32_chars';
  const betterAuthSecret = 'dev_better_auth_secret_32_chars_long';

  const baseValidEnv = {
    [EnvKey.NODE_ENV]: NodeEnvironment.Development,
    [EnvKey.JWT_ACCESS_SECRET]: localJwtAccessSecret,
    [EnvKey.JWT_REFRESH_SECRET]: localJwtRefreshSecret,
    [EnvKey.ADMIN_EMAIL]: adminEmail,
    [EnvKey.ADMIN_PASSWORD]: adminPassword,
    [EnvKey.ADMIN_COOKIE_SECRET]: adminCookieSecret,
    [EnvKey.BETTER_AUTH_SECRET]: betterAuthSecret,
  };

  it('keeps explicit local config values outside production', () => {
    const config = validateEnvironment({
      ...baseValidEnv,
      [EnvKey.DATABASE_URL]: localDatabaseUrl,
    });

    expect(config[EnvKey.ADMIN_EMAIL]).toBe(adminEmail);
    expect(config[EnvKey.ADMIN_PASSWORD]).toBe(adminPassword);
    expect(config[EnvKey.ADMIN_COOKIE_SECRET]).toBe(adminCookieSecret);
  });

  it('requires admin credentials in production', () => {
    expect(() =>
      validateEnvironment({
        [EnvKey.NODE_ENV]: NodeEnvironment.Production,
        [EnvKey.DATABASE_URL]: prodDatabaseUrl,
        [EnvKey.REDIS_URL]: redisUrl,
        [EnvKey.JWT_ACCESS_SECRET]: prodJwtAccessSecret,
        [EnvKey.JWT_REFRESH_SECRET]: prodJwtRefreshSecret,
      }),
    ).toThrow('ADMIN_EMAIL');
  });

  it('accepts complete AI role configurations', () => {
    const config = validateEnvironment({
      ...baseValidEnv,
      [EnvKey.AI_PROVIDER]: 'openai-compatible',
      [EnvKey.AI_ANALYSIS_API_KEY]: 'analysis-key',
      [EnvKey.AI_ANALYSIS_BASE_URL]: 'https://analysis.example.com/v1',
      [EnvKey.AI_ANALYSIS_MODEL]: 'analysis-model',
      [EnvKey.AI_VISION_API_KEY]: 'vision-key',
      [EnvKey.AI_VISION_BASE_URL]: 'https://vision.example.com/v1',
      [EnvKey.AI_VISION_MODEL]: 'vision-model',
      [EnvKey.AI_LANGUAGE_API_KEY]: 'language-key',
      [EnvKey.AI_LANGUAGE_BASE_URL]: 'https://language.example.com/v1',
      [EnvKey.AI_LANGUAGE_MODEL]: 'language-model',
      [EnvKey.AI_CHAT_API_KEY]: 'chat-key',
      [EnvKey.AI_CHAT_BASE_URL]: 'https://chat.example.com/v1',
      [EnvKey.AI_CHAT_MODEL]: 'chat-model',
      [EnvKey.AI_CHAT_COMPRESSION_API_KEY]: 'compression-key',
      [EnvKey.AI_CHAT_COMPRESSION_BASE_URL]:
        'https://compression.example.com/v1',
      [EnvKey.AI_CHAT_COMPRESSION_MODEL]: 'compression-model',
      [EnvKey.AI_EMBEDDING_API_KEY]: 'embedding-key',
      [EnvKey.AI_EMBEDDING_BASE_URL]: 'https://embedding.example.com/v1',
      [EnvKey.AI_EMBEDDING_MODEL]: 'embedding-model',
    });

    expect(config[EnvKey.AI_PROVIDER]).toBe('openai-compatible');
    expect(config[EnvKey.AI_ANALYSIS_MODEL]).toBe('analysis-model');
    expect(config[EnvKey.AI_EMBEDDING_MODEL]).toBe('embedding-model');
  });

  it('rejects incomplete AI role configurations', () => {
    expect(() =>
      validateEnvironment({
        ...baseValidEnv,
        [EnvKey.AI_PROVIDER]: 'openai-compatible',
        [EnvKey.AI_CHAT_API_KEY]: 'chat-key',
        [EnvKey.AI_CHAT_MODEL]: 'chat-model',
      }),
    ).toThrow('Incomplete AI chat configuration');
  });

  it('requires AI_PROVIDER when any AI role is configured', () => {
    expect(() =>
      validateEnvironment({
        ...baseValidEnv,
        [EnvKey.AI_ANALYSIS_API_KEY]: 'analysis-key',
        [EnvKey.AI_ANALYSIS_BASE_URL]: 'https://analysis.example.com/v1',
        [EnvKey.AI_ANALYSIS_MODEL]: 'analysis-model',
      }),
    ).toThrow('AI_PROVIDER is required');
  });

  it('allows COS region alone without treating COS as configured', () => {
    // TENCENT_COS_REGION has been migrated to YAML; it is no longer in
    // the env schema, so passing it should be silently ignored.
    expect(() =>
      validateEnvironment({
        ...baseValidEnv,
      }),
    ).not.toThrow();
  });

  it('still rejects partial COS credentials', () => {
    expect(() =>
      validateEnvironment({
        ...baseValidEnv,
        [EnvKey.TENCENT_COS_BUCKET]: 'lucent-dev',
      }),
    ).toThrow('Incomplete Tencent COS environment variables');
  });

  it('allows JPush to remain disabled when both credentials are absent', () => {
    expect(() =>
      validateEnvironment({
        ...baseValidEnv,
      }),
    ).not.toThrow();
  });

  it('rejects incomplete JPush credentials', () => {
    expect(() =>
      validateEnvironment({
        ...baseValidEnv,
        [EnvKey.JPUSH_APP_KEY]: 'appkey-1',
      }),
    ).toThrow(
      `Incomplete JPush environment variables: ${EnvKey.JPUSH_MASTER_SECRET}`,
    );

    expect(() =>
      validateEnvironment({
        ...baseValidEnv,
        [EnvKey.JPUSH_MASTER_SECRET]: 'secret-1',
      }),
    ).toThrow(
      `Incomplete JPush environment variables: ${EnvKey.JPUSH_APP_KEY}`,
    );
  });
});
