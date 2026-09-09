import { EnvKey } from '../env/env-keys.enum.js';
import { tencentCosConfig } from './tencent-cos.config.js';

describe('tencentCosConfig', () => {
  const saved: Record<string, string | undefined> = {};
  const keysToClean = [
    EnvKey.TENCENT_COS_SECRET_ID,
    EnvKey.TENCENT_COS_SECRET_KEY,
    EnvKey.TENCENT_COS_BUCKET,
    EnvKey.TENCENT_COS_REGION,
    EnvKey.TENCENT_COS_PUBLIC_BASE_URL,
    EnvKey.TENCENT_COS_UPLOAD_EXPIRES_SECONDS,
    EnvKey.TENCENT_COS_MAX_UPLOAD_BYTES,
    EnvKey.TENCENT_COS_DOWNLOAD_EXPIRES_SECONDS,
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
    return tencentCosConfig()!;
  }

  it('returns empty strings for credentials and bucket when env vars are absent', () => {
    const config = callFactory();

    expect(config.secretId).toBe('');
    expect(config.secretKey).toBe('');
    expect(config.bucket).toBe('');
    expect(config.publicBaseUrl).toBe('');
    // Non-sensitive defaults (region, expiries, max bytes) now live in the
    // zod validation layer (`environment.validation.ts`); the factory passes
    // raw env values through without fallback.
  });

  it('reads COS credentials and bucket info from env vars', () => {
    process.env[EnvKey.TENCENT_COS_SECRET_ID] = 'cos-secret-id';
    process.env[EnvKey.TENCENT_COS_SECRET_KEY] = 'cos-secret-key';
    process.env[EnvKey.TENCENT_COS_BUCKET] = 'my-bucket-1234567890';
    process.env[EnvKey.TENCENT_COS_REGION] = 'ap-guangzhou';
    process.env[EnvKey.TENCENT_COS_PUBLIC_BASE_URL] = 'https://cdn.example.com';

    const config = callFactory();

    expect(config.secretId).toBe('cos-secret-id');
    expect(config.secretKey).toBe('cos-secret-key');
    expect(config.bucket).toBe('my-bucket-1234567890');
    expect(config.region).toBe('ap-guangzhou');
    expect(config.publicBaseUrl).toBe('https://cdn.example.com');
  });

  it('parses custom upload/download expiry and max upload size', () => {
    process.env[EnvKey.TENCENT_COS_UPLOAD_EXPIRES_SECONDS] = '120';
    process.env[EnvKey.TENCENT_COS_MAX_UPLOAD_BYTES] = '5242880';
    process.env[EnvKey.TENCENT_COS_DOWNLOAD_EXPIRES_SECONDS] = '300';

    const config = callFactory();

    expect(config.uploadExpiresSeconds).toBe(120);
    expect(config.maxUploadBytes).toBe(5_242_880);
    expect(config.downloadExpiresSeconds).toBe(300);
  });
});
