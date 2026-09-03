import { EnvKey } from '../env/env-keys.enum.js';
import {
  DEFAULT_COS_MAX_UPLOAD_BYTES,
  DEFAULT_COS_UPLOAD_EXPIRY_SECONDS,
} from '../app-defaults.constants.js';
import { s3StorageConfig } from './s3-storage.config.js';

describe('s3StorageConfig', () => {
  const saved: Record<string, string | undefined> = {};
  const keysToClean = [
    EnvKey.STORAGE_S3_ENDPOINT,
    EnvKey.STORAGE_S3_CLIENT_ENDPOINT,
    EnvKey.STORAGE_S3_EXTERNAL_ENDPOINT,
    EnvKey.STORAGE_S3_PUBLIC_BASE_URL,
    EnvKey.STORAGE_S3_ACCESS_KEY,
    EnvKey.STORAGE_S3_SECRET_KEY,
    EnvKey.STORAGE_S3_BUCKET,
    EnvKey.STORAGE_S3_REGION,
    EnvKey.STORAGE_S3_UPLOAD_EXPIRES_SECONDS,
    EnvKey.STORAGE_S3_MAX_UPLOAD_BYTES,
    EnvKey.STORAGE_S3_DOWNLOAD_EXPIRES_SECONDS,
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
    return s3StorageConfig()!;
  }

  it('returns empty strings for all fields when env vars are absent', () => {
    const config = callFactory();

    expect(config.endpoint).toBe('');
    expect(config.clientEndpoint).toBe('');
    expect(config.externalEndpoint).toBe('');
    expect(config.publicBaseUrl).toBe('');
    expect(config.accessKey).toBe('');
    expect(config.secretKey).toBe('');
    expect(config.bucket).toBe('');
  });

  it('defaults region to us-east-1 when not set', () => {
    const config = callFactory();

    expect(config.region).toBe('us-east-1');
  });

  it('uses default expiry and upload size when env vars are absent', () => {
    const config = callFactory();

    expect(config.uploadExpiresSeconds).toBe(DEFAULT_COS_UPLOAD_EXPIRY_SECONDS);
    expect(config.maxUploadBytes).toBe(DEFAULT_COS_MAX_UPLOAD_BYTES);
    expect(config.downloadExpiresSeconds).toBe(
      DEFAULT_COS_UPLOAD_EXPIRY_SECONDS,
    );
  });

  it('reads S3 credentials and endpoints from env vars', () => {
    process.env[EnvKey.STORAGE_S3_ENDPOINT] = 'http://127.0.0.1:8333';
    process.env[EnvKey.STORAGE_S3_CLIENT_ENDPOINT] = 'http://10.0.2.2:8333';
    process.env[EnvKey.STORAGE_S3_EXTERNAL_ENDPOINT] =
      'https://storage-dev.example.test';
    process.env[EnvKey.STORAGE_S3_PUBLIC_BASE_URL] =
      'http://10.0.2.2:8888/buckets/lucent-dev';
    process.env[EnvKey.STORAGE_S3_ACCESS_KEY] = 'lucent-dev';
    process.env[EnvKey.STORAGE_S3_SECRET_KEY] = 'lucent-dev-secret';
    process.env[EnvKey.STORAGE_S3_BUCKET] = 'lucent-dev';
    process.env[EnvKey.STORAGE_S3_REGION] = 'ap-southeast-1';

    const config = callFactory();

    expect(config.endpoint).toBe('http://127.0.0.1:8333');
    expect(config.clientEndpoint).toBe('http://10.0.2.2:8333');
    expect(config.externalEndpoint).toBe('https://storage-dev.example.test');
    expect(config.publicBaseUrl).toBe(
      'http://10.0.2.2:8888/buckets/lucent-dev',
    );
    expect(config.accessKey).toBe('lucent-dev');
    expect(config.secretKey).toBe('lucent-dev-secret');
    expect(config.bucket).toBe('lucent-dev');
    expect(config.region).toBe('ap-southeast-1');
  });

  it('parses custom upload/download expiry and max upload size', () => {
    process.env[EnvKey.STORAGE_S3_UPLOAD_EXPIRES_SECONDS] = '120';
    process.env[EnvKey.STORAGE_S3_MAX_UPLOAD_BYTES] = '5242880';
    process.env[EnvKey.STORAGE_S3_DOWNLOAD_EXPIRES_SECONDS] = '300';

    const config = callFactory();

    expect(config.uploadExpiresSeconds).toBe(120);
    expect(config.maxUploadBytes).toBe(5_242_880);
    expect(config.downloadExpiresSeconds).toBe(300);
  });
});
