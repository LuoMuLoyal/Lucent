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
    // Constructor mocks: command classes are instantiated with `new` —
    // Vitest 4 requires function (not arrow) implementations.
    // oxlint-disable-next-line prefer-arrow-callback
    PutObjectCommand: vi.fn(function (input: unknown) {
      return input;
    }),
    // oxlint-disable-next-line prefer-arrow-callback
    GetObjectCommand: vi.fn(function (input: unknown) {
      return input;
    }),
    // oxlint-disable-next-line prefer-arrow-callback
    HeadBucketCommand: vi.fn(function (input: unknown) {
      return input;
    }),
    // oxlint-disable-next-line prefer-arrow-callback
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
  // Constructor mock: COS is instantiated with `new` — Vitest 4
  // requires a function (not arrow) implementation for constructibility.
  // oxlint-disable-next-line prefer-arrow-callback
  default: vi.fn(function () {
    return {
      getObjectUrl: vi.fn(),
      putObject: vi.fn(),
    };
  }),
}));

// ── Mock ali-oss (needed because AliyunOssStorageRuntime
//    constructor creates an OSS instance) ────────────────────────

vi.mock('ali-oss', () => {
  // Constructor mock: OSS is instantiated with `new` — Vitest 4
  // requires a function (not arrow) implementation for constructibility.
  return {
    __esModule: true,
    // oxlint-disable-next-line prefer-arrow-callback
    default: vi.fn(function () {
      return {
        asyncSignatureUrl: vi.fn(),
        put: vi.fn(),
      };
    }),
  };
});

// Imports must come after vi.mock declarations.

import { ObjectStorageRuntime } from './object-storage.runtime.js';
import { TencentCosStorageRuntime } from './tencent-cos.runtime.js';
import { S3StorageRuntime } from './s3.runtime.js';
import { AliyunOssStorageRuntime } from './aliyun-oss.runtime.js';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { ConfigKey } from '../../config/env/config-keys.enum.js';
import type { S3StorageConfig } from '../../config/services/s3-storage.config.js';
import type { TencentCosConfig } from '../../config/services/tencent-cos.config.js';
import type { AliyunOssConfig } from '../../config/services/aliyun-oss.config.js';

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

const aliyunOssConfig: AliyunOssConfig = {
  accessKeyId: 'test-oss-access-key-id',
  accessKeySecret: 'test-oss-access-key-secret',
  bucket: 'test-oss-bucket',
  region: 'oss-cn-hangzhou',
  endpoint: '',
  publicBaseUrl: '',
  uploadExpiresSeconds: 600,
  maxUploadBytes: 10_485_760,
  downloadExpiresSeconds: 600,
};

/**
 * Builds a fake ConfigService whose `get` returns the given provider
 * string for `STORAGE_PROVIDER`, falling back to the validated default
 * `'s3'` when unset (mirrors the zod validation backfill in
 * `environment.validation.ts`), and whose `getOrThrow` returns the
 * matching config object for the known ConfigKey.
 */
function buildConfigService(): ConfigService {
  return {
    get: vi.fn().mockImplementation(() => {
      return process.env[EnvKey.STORAGE_PROVIDER] ?? 's3';
    }),
    getOrThrow: vi.fn().mockImplementation((key: string) => {
      if (key === (ConfigKey.TencentCos as string)) return tencentCosConfig;
      if (key === (ConfigKey.S3Storage as string)) return s3StorageConfig;
      if (key === (ConfigKey.AliyunOss as string)) return aliyunOssConfig;
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
  if (provider === undefined) {
    Reflect.deleteProperty(process.env, EnvKey.STORAGE_PROVIDER);
  } else {
    process.env[EnvKey.STORAGE_PROVIDER] = provider;
  }
  return Test.createTestingModule({
    providers: [
      {
        provide: ConfigService,
        useValue: buildConfigService(),
      },
      {
        provide: ObjectStorageRuntime,
        useFactory: (configService: ConfigService): ObjectStorageRuntime => {
          const resolved =
            configService.get<string>(EnvKey.STORAGE_PROVIDER) ?? 's3';
          if (resolved === 's3') {
            return new S3StorageRuntime(configService);
          }
          if (resolved === 'tencent-cos') {
            return new TencentCosStorageRuntime(configService);
          }
          if (resolved === 'ali-oss') {
            return new AliyunOssStorageRuntime(configService);
          }
          throw new ServiceUnavailableException({
            code: 'DEPENDENCY_UNAVAILABLE',
            message:
              `STORAGE_PROVIDER "${resolved}" is not supported. ` +
              'Use "tencent-cos", "s3", or "ali-oss".',
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
    Reflect.deleteProperty(process.env, EnvKey.STORAGE_PROVIDER);
  });

  it('binds S3StorageRuntime to ObjectStorageRuntime when STORAGE_PROVIDER is not set', async () => {
    const module = await buildStorageModule(undefined);
    const runtime = module.get(ObjectStorageRuntime);

    expect(runtime).toBeInstanceOf(S3StorageRuntime);
    expect(runtime.provider).toBe('s3');
  });

  it('binds TencentCosStorageRuntime when STORAGE_PROVIDER is tencent-cos', async () => {
    const module = await buildStorageModule('tencent-cos');
    const runtime = module.get(ObjectStorageRuntime);

    expect(runtime).toBeInstanceOf(TencentCosStorageRuntime);
    expect(runtime.provider).toBe('tencent-cos');
  });

  it('binds AliyunOssStorageRuntime when STORAGE_PROVIDER is ali-oss', async () => {
    const module = await buildStorageModule('ali-oss');
    const runtime = module.get(ObjectStorageRuntime);

    expect(runtime).toBeInstanceOf(AliyunOssStorageRuntime);
    expect(runtime.provider).toBe('ali-oss');
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
