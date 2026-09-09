import { EnvKey } from '../env/env-keys.enum.js';
import { aliyunOssConfig } from './aliyun-oss.config.js';

describe('aliyunOssConfig', () => {
  const saved: Record<string, string | undefined> = {};
  const keysToClean = [
    EnvKey.ALIYUN_OSS_ACCESS_KEY_ID,
    EnvKey.ALIYUN_OSS_ACCESS_KEY_SECRET,
    EnvKey.ALIYUN_OSS_BUCKET,
    EnvKey.ALIYUN_OSS_REGION,
    EnvKey.ALIYUN_OSS_ENDPOINT,
    EnvKey.ALIYUN_OSS_PUBLIC_BASE_URL,
    EnvKey.ALIYUN_OSS_UPLOAD_EXPIRES_SECONDS,
    EnvKey.ALIYUN_OSS_MAX_UPLOAD_BYTES,
    EnvKey.ALIYUN_OSS_DOWNLOAD_EXPIRES_SECONDS,
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
    return aliyunOssConfig()!;
  }

  it('returns empty strings for credentials, bucket, and endpoint when env vars are absent', () => {
    const config = callFactory();

    expect(config.accessKeyId).toBe('');
    expect(config.accessKeySecret).toBe('');
    expect(config.bucket).toBe('');
    expect(config.region).toBe('');
    expect(config.endpoint).toBe('');
    expect(config.publicBaseUrl).toBe('');
    // Non-sensitive defaults (region, expiries, max bytes) now live in the
    // zod validation layer (`environment.validation.ts`); the factory passes
    // raw env values through without fallback.
  });

  it('reads OSS credentials and bucket info from env vars', () => {
    process.env[EnvKey.ALIYUN_OSS_ACCESS_KEY_ID] = 'oss-access-key-id';
    process.env[EnvKey.ALIYUN_OSS_ACCESS_KEY_SECRET] = 'oss-access-key-secret';
    process.env[EnvKey.ALIYUN_OSS_BUCKET] = 'my-oss-bucket';
    process.env[EnvKey.ALIYUN_OSS_REGION] = 'oss-cn-beijing';
    process.env[EnvKey.ALIYUN_OSS_ENDPOINT] = 'https://oss.example.com';
    process.env[EnvKey.ALIYUN_OSS_PUBLIC_BASE_URL] = 'https://cdn.example.com';

    const config = callFactory();

    expect(config.accessKeyId).toBe('oss-access-key-id');
    expect(config.accessKeySecret).toBe('oss-access-key-secret');
    expect(config.bucket).toBe('my-oss-bucket');
    expect(config.region).toBe('oss-cn-beijing');
    expect(config.endpoint).toBe('https://oss.example.com');
    expect(config.publicBaseUrl).toBe('https://cdn.example.com');
  });

  it('parses custom upload/download expiry and max upload size', () => {
    process.env[EnvKey.ALIYUN_OSS_UPLOAD_EXPIRES_SECONDS] = '120';
    process.env[EnvKey.ALIYUN_OSS_MAX_UPLOAD_BYTES] = '5242880';
    process.env[EnvKey.ALIYUN_OSS_DOWNLOAD_EXPIRES_SECONDS] = '300';

    const config = callFactory();

    expect(config.uploadExpiresSeconds).toBe(120);
    expect(config.maxUploadBytes).toBe(5_242_880);
    expect(config.downloadExpiresSeconds).toBe(300);
  });
});
