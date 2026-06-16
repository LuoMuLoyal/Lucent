import { EnvKey } from './env-keys.enum';
import { NodeEnvironment, validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  it('keeps explicit local config values outside production', () => {
    const config = validateEnvironment({
      [EnvKey.NODE_ENV]: NodeEnvironment.Development,
      [EnvKey.DATABASE_URL]:
        'postgresql://postgres:postgres@127.0.0.1:15432/lucent?schema=public',
      [EnvKey.JWT_ACCESS_SECRET]: 'local-access-secret',
      [EnvKey.JWT_REFRESH_SECRET]: 'local-refresh-secret',
      [EnvKey.ADMIN_EMAIL]: 'admin@example.com',
      [EnvKey.ADMIN_PASSWORD]: 'admin12345',
      [EnvKey.ADMIN_COOKIE_SECRET]: 'dev_lucent_admin_cookie_secret_32_chars',
    });

    expect(config[EnvKey.ADMIN_EMAIL]).toBe('admin@example.com');
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

  it('accepts complete AI role configurations', () => {
    const config = validateEnvironment({
      [EnvKey.NODE_ENV]: NodeEnvironment.Development,
      [EnvKey.JWT_ACCESS_SECRET]: 'local-access-secret',
      [EnvKey.JWT_REFRESH_SECRET]: 'local-refresh-secret',
      [EnvKey.ADMIN_EMAIL]: 'admin@example.com',
      [EnvKey.ADMIN_PASSWORD]: 'admin12345',
      [EnvKey.ADMIN_COOKIE_SECRET]: 'dev_lucent_admin_cookie_secret_32_chars',
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
        [EnvKey.NODE_ENV]: NodeEnvironment.Development,
        [EnvKey.JWT_ACCESS_SECRET]: 'local-access-secret',
        [EnvKey.JWT_REFRESH_SECRET]: 'local-refresh-secret',
        [EnvKey.ADMIN_EMAIL]: 'admin@example.com',
        [EnvKey.ADMIN_PASSWORD]: 'admin12345',
        [EnvKey.ADMIN_COOKIE_SECRET]: 'dev_lucent_admin_cookie_secret_32_chars',
        [EnvKey.AI_PROVIDER]: 'openai-compatible',
        [EnvKey.AI_CHAT_API_KEY]: 'chat-key',
        [EnvKey.AI_CHAT_MODEL]: 'chat-model',
      }),
    ).toThrow('Incomplete AI chat configuration');
  });

  it('requires AI_PROVIDER when any AI role is configured', () => {
    expect(() =>
      validateEnvironment({
        [EnvKey.NODE_ENV]: NodeEnvironment.Development,
        [EnvKey.JWT_ACCESS_SECRET]: 'local-access-secret',
        [EnvKey.JWT_REFRESH_SECRET]: 'local-refresh-secret',
        [EnvKey.ADMIN_EMAIL]: 'admin@example.com',
        [EnvKey.ADMIN_PASSWORD]: 'admin12345',
        [EnvKey.ADMIN_COOKIE_SECRET]: 'dev_lucent_admin_cookie_secret_32_chars',
        [EnvKey.AI_ANALYSIS_API_KEY]: 'analysis-key',
        [EnvKey.AI_ANALYSIS_BASE_URL]: 'https://analysis.example.com/v1',
        [EnvKey.AI_ANALYSIS_MODEL]: 'analysis-model',
      }),
    ).toThrow('AI_PROVIDER is required');
  });

  it('allows default COS region alone without treating COS as configured', () => {
    const config = validateEnvironment({
      [EnvKey.NODE_ENV]: NodeEnvironment.Development,
      [EnvKey.JWT_ACCESS_SECRET]: 'local-access-secret',
      [EnvKey.JWT_REFRESH_SECRET]: 'local-refresh-secret',
      [EnvKey.ADMIN_EMAIL]: 'admin@example.com',
      [EnvKey.ADMIN_PASSWORD]: 'admin12345',
      [EnvKey.ADMIN_COOKIE_SECRET]: 'dev_lucent_admin_cookie_secret_32_chars',
      [EnvKey.TENCENT_COS_REGION]: 'ap-guangzhou',
    });

    expect(config[EnvKey.TENCENT_COS_REGION]).toBe('ap-guangzhou');
  });

  it('still rejects partial COS credentials when upload config really starts', () => {
    expect(() =>
      validateEnvironment({
        [EnvKey.NODE_ENV]: NodeEnvironment.Development,
        [EnvKey.JWT_ACCESS_SECRET]: 'local-access-secret',
        [EnvKey.JWT_REFRESH_SECRET]: 'local-refresh-secret',
        [EnvKey.ADMIN_EMAIL]: 'admin@example.com',
        [EnvKey.ADMIN_PASSWORD]: 'admin12345',
        [EnvKey.ADMIN_COOKIE_SECRET]: 'dev_lucent_admin_cookie_secret_32_chars',
        [EnvKey.TENCENT_COS_BUCKET]: 'lucent-dev',
        [EnvKey.TENCENT_COS_REGION]: 'ap-guangzhou',
      }),
    ).toThrow('Incomplete Tencent COS environment variables');
  });
});
