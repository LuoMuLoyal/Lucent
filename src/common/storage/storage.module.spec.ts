import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { vi } from 'vitest';

// ── Mock AWS SDK v3 (needed because S3StorageRuntime constructor
//    creates S3Client instances) ──────────────────────────────────

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    config = { region: 'us-east-1' };
    send = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(_config: unknown) {}
  }

  return {
    S3Client: MockS3Client,
    PutObjectCommand: vi.fn(function (input: unknown) {
      return input;
    }),
    GetObjectCommand: vi.fn(function (input: unknown) {
      return input;
    }),
    HeadBucketCommand: vi.fn(function (input: unknown) {
      return input;
    }),
    CreateBucketCommand: vi.fn(function (input: unknown) {
      return input;
    }),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

// ── Mock cos-nodejs-sdk-v5 (needed because TencentCosStorageRuntime
//    constructor creates a COS instance) ──────────────────────────

vi.mock('cos-nodejs-sdk-v5', () => ({
  __esModule: true,
  default: vi.fn(function () {
    return {
      getObjectUrl: vi.fn(),
      putObject: vi.fn(),
    };
  }),
}));

// Imports must come after vi.mock declarations.

import { ObjectStorageRuntime } from './object-storage.runtime';
import { TencentCosStorageRuntime } from './tencent-cos.runtime';
import { S3StorageRuntime } from './s3.runtime';
import { EnvKey } from '../../config/env/env-keys.enum';
import { ConfigKey } from '../../config/env/config-keys.enum';
import type { S3StorageConfig } from '../../config/services/s3-storage.config';
import type { TencentCosConfig } from '../../config/services/tencent-cos.config';

// ── Config fixtures ──────────────────────────────────────────────

const tencentCosConfig: TencentCosConfig = {
  secretId: 'test-secret-id',
  secretKey: 'test-secret-key',
  bucket: 'test-bucket',
  region: 'ap-guangzhou',
  publicBaseUrl: '',
  uploadExpiresSeconds: 600,
  maxUploadBytes: 10_485_760,
  downloadExpiresSeconds: 600,
};

const s3StorageConfig: S3StorageConfig = {
  endpoint: 'http://127.0.0.1:8333',
  clientEndpoint: 'http://127.0.0.1:8333',
  externalEndpoint: '',
  publicBaseUrl: '',
  accessKey: 'lucent-dev',
  secretKey: 'lucent-dev-secret',
  bucket: 'lucent-dev',
  region: 'us-east-1',
  uploadExpiresSeconds: 600,
  maxUploadBytes: 10_485_760,
  downloadExpiresSeconds: 600,
};

/**
 * Builds a fake ConfigService whose `get` returns the given provider
 * string for `STORAGE_PROVIDER`, and whose `getOrThrow` returns the
 * matching config object for the known ConfigKey.
 */
function buildConfigService(provider: string | undefined): ConfigService {
  return {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === (EnvKey.STORAGE_PROVIDER as string)) return provider;
      return undefined;
    }),
    getOrThrow: vi.fn().mockImplementation((key: string) => {
      if (key === (ConfigKey.TencentCos as string)) return tencentCosConfig;
      if (key === (ConfigKey.S3Storage as string)) return s3StorageConfig;
      throw new Error(`Unexpected config key: ${key}`);
    }),
  } as unknown as ConfigService;
}

/**
 * Creates a TestingModule that mirrors the StorageModule's provider
 * configuration, with a real `ConfigService` override so the factory
 * can resolve its `inject: [ConfigService]` dependency.
 *
 * We inline the factory instead of using `imports: [StorageModule]`
 * because `StorageModule` does not import `ConfigModule`; in
 * production `ConfigModule.forRoot({ isGlobal: true })` in
 * `AppModule` makes `ConfigService` available globally, but in a
 * unit test without `AppModule` the TestingInjector cannot find it
 * unless we supply it in the same `providers` array.
 */
async function buildStorageModule(
  provider: string | undefined,
): Promise<TestingModule> {
  return Test.createTestingModule({
    providers: [
      {
        provide: ConfigService,
        useValue: buildConfigService(provider),
      },
      {
        provide: ObjectStorageRuntime,
        useFactory: (configService: ConfigService): ObjectStorageRuntime => {
          const resolved =
            configService.get<string>(EnvKey.STORAGE_PROVIDER) ?? 'tencent-cos';
          if (resolved === 's3') {
            return new S3StorageRuntime(configService);
          }
          if (resolved === 'tencent-cos') {
            return new TencentCosStorageRuntime(configService);
          }
          throw new ServiceUnavailableException({
            code: 'DEPENDENCY_UNAVAILABLE',
            message:
              `STORAGE_PROVIDER "${resolved}" is not supported. ` +
              'Use "tencent-cos" or "s3".',
          });
        },
        inject: [ConfigService],
      },
    ],
  }).compile();
}

// ── Tests ───────────────────────────────────────────────────────

describe('StorageModule', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds TencentCosStorageRuntime to ObjectStorageRuntime when STORAGE_PROVIDER is not set', async () => {
    const module = await buildStorageModule(undefined);
    const runtime = module.get(ObjectStorageRuntime);

    expect(runtime).toBeInstanceOf(TencentCosStorageRuntime);
    expect(runtime.provider).toBe('tencent-cos');
  });

  it('binds TencentCosStorageRuntime when STORAGE_PROVIDER is tencent-cos', async () => {
    const module = await buildStorageModule('tencent-cos');
    const runtime = module.get(ObjectStorageRuntime);

    expect(runtime).toBeInstanceOf(TencentCosStorageRuntime);
    expect(runtime.provider).toBe('tencent-cos');
  });

  it('binds S3StorageRuntime when STORAGE_PROVIDER is s3', async () => {
    const module = await buildStorageModule('s3');
    const runtime = module.get(ObjectStorageRuntime);

    expect(runtime).toBeInstanceOf(S3StorageRuntime);
    expect(runtime.provider).toBe('s3');
  });

  it('throws on unknown provider during module initialization', async () => {
    // The factory throws synchronously when the TestingModule compiles,
    // which surfaces as an Error during module creation.
    await expect(buildStorageModule('minio')).rejects.toThrow(
      /STORAGE_PROVIDER/,
    );
  });
});
