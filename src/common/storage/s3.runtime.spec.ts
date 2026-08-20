import type { ConfigService } from '@nestjs/config';
import type { S3StorageConfig } from '../../config/services/s3-storage.config';
import { S3StorageRuntime } from './s3.runtime';

// ── Mock AWS SDK v3 ──────────────────────────────────────────────

const mockS3Send = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    config = { region: 'us-east-1' };
    send = mockS3Send;
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

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ── Helpers ──────────────────────────────────────────────────────

function buildS3Config(
  overrides: Partial<S3StorageConfig> = {},
): S3StorageConfig {
  return {
    endpoint: 'http://127.0.0.1:8333',
    clientEndpoint: 'http://10.0.2.2:8333',
    externalEndpoint: '',
    publicBaseUrl: '',
    accessKey: 'lucent-dev',
    secretKey: 'lucent-dev-secret',
    bucket: 'lucent-dev',
    region: 'us-east-1',
    uploadExpiresSeconds: 600,
    maxUploadBytes: 10_485_760,
    downloadExpiresSeconds: 600,
    ...overrides,
  };
}

function buildConfigService(config: S3StorageConfig): ConfigService {
  return {
    getOrThrow: vi.fn().mockReturnValue(config),
  } as unknown as ConfigService;
}

// ── Tests ────────────────────────────────────────────────────────

describe('S3StorageRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('provider', () => {
    it('returns "s3" as provider', () => {
      const runtime = new S3StorageRuntime(buildConfigService(buildS3Config()));
      expect(runtime.provider).toBe('s3');
    });
  });

  describe('getConfig()', () => {
    it('returns provider-agnostic config', () => {
      const runtime = new S3StorageRuntime(buildConfigService(buildS3Config()));
      const config = runtime.getConfig();

      expect(config.provider).toBe('s3');
      expect(config.bucket).toBe('lucent-dev');
      expect(config.region).toBe('us-east-1');
      expect(config.uploadExpiresSeconds).toBe(600);
      expect(config.maxUploadBytes).toBe(10_485_760);
      expect(config.downloadExpiresSeconds).toBe(600);
    });
  });

  describe('isConfigured()', () => {
    it('returns true when endpoint, credentials, and bucket are set', () => {
      const runtime = new S3StorageRuntime(buildConfigService(buildS3Config()));
      expect(runtime.isConfigured()).toBe(true);
    });

    it('returns false when endpoint is empty', () => {
      const runtime = new S3StorageRuntime(
        buildConfigService(buildS3Config({ endpoint: '' })),
      );
      expect(runtime.isConfigured()).toBe(false);
    });

    it('returns false when accessKey is empty', () => {
      const runtime = new S3StorageRuntime(
        buildConfigService(buildS3Config({ accessKey: '' })),
      );
      expect(runtime.isConfigured()).toBe(false);
    });

    it('returns false when bucket is empty', () => {
      const runtime = new S3StorageRuntime(
        buildConfigService(buildS3Config({ bucket: '' })),
      );
      expect(runtime.isConfigured()).toBe(false);
    });
  });

  describe('createSignedPutUrl()', () => {
    it('uses the client endpoint for presigned PUT URL', async () => {
      const config = buildS3Config({
        clientEndpoint: 'http://10.0.2.2:8333',
      });
      vi.mocked(getSignedUrl).mockResolvedValue(
        'http://10.0.2.2:8333/lucent-dev/put-key',
      );

      const runtime = new S3StorageRuntime(buildConfigService(config));
      const url = await runtime.createSignedPutUrl({
        objectKey: 'uploads/test.png',
        contentType: 'image/png',
      });

      expect(url).toBe('http://10.0.2.2:8333/lucent-dev/put-key');
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Bucket: 'lucent-dev',
          Key: 'uploads/test.png',
          ContentType: 'image/png',
        }),
        { expiresIn: 600 },
      );
    });

    it('falls back to internal endpoint when client endpoint is not set', async () => {
      const config = buildS3Config({
        endpoint: 'http://127.0.0.1:8333',
        clientEndpoint: '',
      });
      vi.mocked(getSignedUrl).mockResolvedValue(
        'http://127.0.0.1:8333/lucent-dev/put-key',
      );

      const runtime = new S3StorageRuntime(buildConfigService(config));
      const url = await runtime.createSignedPutUrl({
        objectKey: 'uploads/test.png',
        contentType: 'image/png',
      });

      expect(url).toBe('http://127.0.0.1:8333/lucent-dev/put-key');
    });
  });

  describe('createSignedGetUrl()', () => {
    it('uses client endpoint for client audience', async () => {
      const config = buildS3Config({
        clientEndpoint: 'http://10.0.2.2:8333',
      });
      vi.mocked(getSignedUrl).mockResolvedValue(
        'http://10.0.2.2:8333/lucent-dev/get-key',
      );

      const runtime = new S3StorageRuntime(buildConfigService(config));
      const url = await runtime.createSignedGetUrl({
        objectKey: 'downloads/report.pdf',
        audience: 'client',
      });

      expect(url).toBe('http://10.0.2.2:8333/lucent-dev/get-key');
    });

    it('uses external endpoint for external audience when configured', async () => {
      const config = buildS3Config({
        externalEndpoint: 'https://storage-dev.example.test',
      });
      vi.mocked(getSignedUrl).mockResolvedValue(
        'https://storage-dev.example.test/lucent-dev/get-key',
      );

      const runtime = new S3StorageRuntime(buildConfigService(config));
      const url = await runtime.createSignedGetUrl({
        objectKey: 'downloads/report.pdf',
        audience: 'external',
      });

      expect(url).toBe('https://storage-dev.example.test/lucent-dev/get-key');
    });

    it('throws a clear configuration error for external audience when external endpoint is not set', async () => {
      const config = buildS3Config({ externalEndpoint: '' });
      const runtime = new S3StorageRuntime(buildConfigService(config));

      await expect(
        runtime.createSignedGetUrl({
          objectKey: 'downloads/report.pdf',
          audience: 'external',
        }),
      ).rejects.toThrow(/STORAGE_S3_EXTERNAL_ENDPOINT/);
    });
  });

  describe('ensureBucket()', () => {
    it('creates the bucket when HeadBucket returns a not-found error', async () => {
      const notFoundError = Object.assign(new Error('Not Found'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });
      mockS3Send
        .mockRejectedValueOnce(notFoundError) // HeadBucket
        .mockResolvedValueOnce({}); // CreateBucket

      const runtime = new S3StorageRuntime(buildConfigService(buildS3Config()));
      await runtime.ensureBucket();

      // HeadBucket + CreateBucket = 2 calls
      expect(mockS3Send).toHaveBeenCalledTimes(2);
    });

    it('does not create the bucket when it already exists', async () => {
      mockS3Send.mockResolvedValueOnce({}); // HeadBucket succeeds

      const runtime = new S3StorageRuntime(buildConfigService(buildS3Config()));
      await runtime.ensureBucket();

      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });

    it('propagates errors that are not not-found', async () => {
      const authError = Object.assign(new Error('Access Denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      mockS3Send.mockRejectedValueOnce(authError);

      const runtime = new S3StorageRuntime(buildConfigService(buildS3Config()));
      await expect(runtime.ensureBucket()).rejects.toThrow('Access Denied');
      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });

    it('only calls ensureBucket once on subsequent invocations', async () => {
      mockS3Send.mockResolvedValueOnce({}); // First HeadBucket succeeds

      const runtime = new S3StorageRuntime(buildConfigService(buildS3Config()));
      await runtime.ensureBucket();
      await runtime.ensureBucket(); // should be no-op

      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });
  });

  describe('uploadBuffer()', () => {
    it('uploads buffer via the internal S3 client', async () => {
      mockS3Send.mockResolvedValueOnce({});

      const runtime = new S3StorageRuntime(buildConfigService(buildS3Config()));
      const buffer = Buffer.from('pdf content');

      await runtime.uploadBuffer({
        objectKey: 'exports/report.pdf',
        contentType: 'application/pdf',
        body: buffer,
      });

      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'lucent-dev',
          Key: 'exports/report.pdf',
          Body: buffer,
          ContentType: 'application/pdf',
          ContentLength: buffer.byteLength,
        }),
      );
    });
  });
});
