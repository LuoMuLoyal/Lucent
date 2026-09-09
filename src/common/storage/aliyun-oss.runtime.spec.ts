import type { ConfigService } from '@nestjs/config';
import type { AliyunOssConfig } from '../../config/services/aliyun-oss.config.js';
import { AliyunOssStorageRuntime } from './aliyun-oss.runtime.js';

// ── Mock ali-oss ────────────────────────────────────────────────

const mockAsyncSignatureUrl = vi.fn();
const mockPut = vi.fn();

vi.mock('ali-oss', () => {
  // Constructor mock: OSS is instantiated with `new` — Vitest 4
  // requires a function (not arrow) implementation for constructibility.
  return {
    __esModule: true,
    // oxlint-disable-next-line prefer-arrow-callback
    default: vi.fn(function () {
      return {
        asyncSignatureUrl: mockAsyncSignatureUrl,
        put: mockPut,
      };
    }),
  };
});

import OSS from 'ali-oss';

// ── Helpers ──────────────────────────────────────────────────────

function buildConfig(
  overrides: Partial<AliyunOssConfig> = {},
): AliyunOssConfig {
  return {
    accessKeyId: 'test-access-key-id',
    accessKeySecret: 'test-access-key-secret',
    bucket: 'test-bucket',
    region: 'oss-cn-hangzhou',
    endpoint: '',
    publicBaseUrl: 'https://cdn.example.com',
    uploadExpiresSeconds: 600,
    maxUploadBytes: 10_485_760,
    downloadExpiresSeconds: 600,
    ...overrides,
  };
}

function buildConfigService(config: AliyunOssConfig): ConfigService {
  return {
    getOrThrow: vi.fn().mockReturnValue(config),
  } as unknown as ConfigService;
}

const ossMock = OSS as unknown as vi.Mock;

// ── Tests ────────────────────────────────────────────────────────

describe('AliyunOssStorageRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an OSS client with accessKeyId, accessKeySecret, region, and bucket', () => {
    const config = buildConfig();
    const configService = buildConfigService(config);

    new AliyunOssStorageRuntime(configService);

    expect(ossMock).toHaveBeenCalledWith({
      region: 'oss-cn-hangzhou',
      accessKeyId: 'test-access-key-id',
      accessKeySecret: 'test-access-key-secret',
      bucket: 'test-bucket',
      endpoint: undefined,
    });
  });

  it('passes endpoint when set', () => {
    const config = buildConfig({ endpoint: 'https://oss.example.com' });
    const configService = buildConfigService(config);

    new AliyunOssStorageRuntime(configService);

    expect(ossMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://oss.example.com',
      }),
    );
  });

  it('getConfig() returns the provider-agnostic config', () => {
    const config = buildConfig({ bucket: 'my-bucket' });
    const configService = buildConfigService(config);

    const runtime = new AliyunOssStorageRuntime(configService);
    const result = runtime.getConfig();

    expect(result.provider).toBe('ali-oss');
    expect(result.bucket).toBe('my-bucket');
    expect(result.region).toBe('oss-cn-hangzhou');
    expect(result.publicBaseUrl).toBe('https://cdn.example.com');
    expect(result.uploadExpiresSeconds).toBe(600);
    expect(result.maxUploadBytes).toBe(10_485_760);
    expect(result.downloadExpiresSeconds).toBe(600);
  });

  it('isConfigured() returns true when all credentials and bucket are set', () => {
    const configService = buildConfigService(buildConfig());
    const runtime = new AliyunOssStorageRuntime(configService);

    expect(runtime.isConfigured()).toBe(true);
  });

  it('isConfigured() returns false when accessKeyId is empty', () => {
    const configService = buildConfigService(buildConfig({ accessKeyId: '' }));
    const runtime = new AliyunOssStorageRuntime(configService);

    expect(runtime.isConfigured()).toBe(false);
  });

  it('isConfigured() returns false when accessKeySecret is empty', () => {
    const configService = buildConfigService(
      buildConfig({ accessKeySecret: '' }),
    );
    const runtime = new AliyunOssStorageRuntime(configService);

    expect(runtime.isConfigured()).toBe(false);
  });

  it('isConfigured() returns false when bucket is empty', () => {
    const configService = buildConfigService(buildConfig({ bucket: '' }));
    const runtime = new AliyunOssStorageRuntime(configService);

    expect(runtime.isConfigured()).toBe(false);
  });

  describe('createSignedPutUrl()', () => {
    it('calls asyncSignatureUrl with PUT method and correct parameters', async () => {
      const config = buildConfig({
        bucket: 'put-bucket',
        region: 'oss-cn-beijing',
        uploadExpiresSeconds: 300,
      });
      const configService = buildConfigService(config);
      mockAsyncSignatureUrl.mockResolvedValue(
        'https://put-bucket.oss-cn-beijing.aliyuncs.com/signed-put',
      );

      const runtime = new AliyunOssStorageRuntime(configService);
      const url = await runtime.createSignedPutUrl({
        objectKey: 'uploads/test-file.png',
        contentType: 'image/png',
      });

      expect(url).toBe(
        'https://put-bucket.oss-cn-beijing.aliyuncs.com/signed-put',
      );
      expect(mockAsyncSignatureUrl).toHaveBeenCalledWith(
        'uploads/test-file.png',
        {
          method: 'PUT',
          expires: 300,
          'Content-Type': 'image/png',
        },
      );
    });
  });

  describe('createSignedGetUrl()', () => {
    it('calls asyncSignatureUrl with GET method for client audience', async () => {
      const config = buildConfig({
        bucket: 'get-bucket',
        region: 'oss-cn-shanghai',
        downloadExpiresSeconds: 180,
      });
      const configService = buildConfigService(config);
      mockAsyncSignatureUrl.mockResolvedValue(
        'https://get-bucket.oss-cn-shanghai.aliyuncs.com/signed-get',
      );

      const runtime = new AliyunOssStorageRuntime(configService);
      const url = await runtime.createSignedGetUrl({
        objectKey: 'downloads/report.pdf',
        audience: 'client',
      });

      expect(url).toBe(
        'https://get-bucket.oss-cn-shanghai.aliyuncs.com/signed-get',
      );
      expect(mockAsyncSignatureUrl).toHaveBeenCalledWith(
        'downloads/report.pdf',
        {
          method: 'GET',
          expires: 180,
        },
      );
    });

    it('returns the same URL for external audience', async () => {
      const config = buildConfig();
      const configService = buildConfigService(config);
      mockAsyncSignatureUrl.mockResolvedValue('https://signed-url.example.com');

      const runtime = new AliyunOssStorageRuntime(configService);
      const url = await runtime.createSignedGetUrl({
        objectKey: 'downloads/report.pdf',
        audience: 'external',
      });

      expect(url).toBe('https://signed-url.example.com');
    });
  });

  describe('uploadBuffer()', () => {
    it('calls oss.put with the buffer and metadata', async () => {
      const config = buildConfig({
        bucket: 'upload-bucket',
        region: 'oss-cn-hangzhou',
      });
      const configService = buildConfigService(config);
      mockPut.mockResolvedValue({ name: 'files/test.txt', url: 'https://...' });

      const runtime = new AliyunOssStorageRuntime(configService);
      const buffer = Buffer.from('test file content');

      await runtime.uploadBuffer({
        objectKey: 'files/test.txt',
        contentType: 'text/plain',
        body: buffer,
      });

      expect(mockPut).toHaveBeenCalledWith('files/test.txt', buffer, {
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': String(buffer.byteLength),
        },
      });
    });

    it('propagates errors from oss.put', async () => {
      const config = buildConfig();
      const configService = buildConfigService(config);
      mockPut.mockRejectedValue(new Error('OSS upload failed'));

      const runtime = new AliyunOssStorageRuntime(configService);

      await expect(
        runtime.uploadBuffer({
          objectKey: 'files/test.txt',
          contentType: 'text/plain',
          body: Buffer.from('content'),
        }),
      ).rejects.toThrow('OSS upload failed');
    });
  });
});
