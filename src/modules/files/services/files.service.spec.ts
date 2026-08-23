import type {
  ObjectStorageConfig,
  ObjectStorageRuntime,
} from '../../../common';
import { unwrapResult } from '../../../common/result';
import type { ResultAsync, DomainFailure } from '../../../common/result';
import { FilesService } from './files.service';

const mockUuid = '00000000-0000-0000-0000-000000000000';
vi.mock('node:crypto', () => ({
  randomUUID: () => mockUuid,
}));

/** Folds a ResultAsync into a plain outcome so specs can assert code/value. */
async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('FilesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function testConfig(
    overrides?: Partial<ObjectStorageConfig>,
  ): ObjectStorageConfig {
    return {
      provider: 'tencent-cos',
      bucket: 'lucent-test-bucket',
      region: 'ap-guangzhou',
      publicBaseUrl: 'https://cdn.example.com/',
      uploadExpiresSeconds: 600,
      maxUploadBytes: 10_485_760,
      downloadExpiresSeconds: 600,
      ...overrides,
    };
  }

  function runtimeDouble(config: ObjectStorageConfig): ObjectStorageRuntime {
    return {
      provider: config.provider,
      getConfig: vi.fn().mockReturnValue(config),
      createSignedPutUrl: vi
        .fn()
        .mockResolvedValue('https://signed-upload.example.com'),
      createSignedGetUrl: vi
        .fn()
        .mockResolvedValue('https://signed-download.example.com'),
      uploadBuffer: vi.fn().mockResolvedValue(undefined),
      isConfigured: vi.fn().mockReturnValue(true),
    } as unknown as ObjectStorageRuntime;
  }

  describe('createPresignedUpload', () => {
    it('should create a presigned upload URL for a valid image', async () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime);

      const result = await unwrapResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/jpeg',
          sizeBytes: 204800,
          fileName: 'photo.jpg',
        }),
      );

      expect(result.provider).toBe('tencent-cos');
      expect(result.bucket).toBe('lucent-test-bucket');
      expect(result.uploadUrl).toBe('https://signed-upload.example.com');
      expect(result.headers).toEqual({ 'Content-Type': 'image/jpeg' });
      expect(result.maxSizeBytes).toBe(10_485_760);
      expect(result.objectKey).toMatch(/^files\/user-1\/[0-9a-f-]+\.jpg$/);
      expect(result.publicUrl).toMatch(
        /^https:\/\/cdn\.example\.com\/files\/user-1\//,
      );
      expect(result.expiresAt).toBeDefined();
      expect(runtime.createSignedPutUrl).toHaveBeenCalledTimes(1);
    });

    it('should reject unsupported content types with VALIDATION_FAILED', async () => {
      const service = new FilesService(runtimeDouble(testConfig()));

      const result = await collectResult(
        service.createPresignedUpload('user-1', {
          contentType: 'application/pdf',
          sizeBytes: 1024,
        }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
        expect(result.error.kind).toBe('validation');
      }
    });

    it('should reject empty contentType with VALIDATION_FAILED', async () => {
      const service = new FilesService(runtimeDouble(testConfig()));

      const result = await collectResult(
        service.createPresignedUpload('user-1', {
          contentType: '   ',
          sizeBytes: 1024,
        }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('should reject files exceeding the size limit with VALIDATION_FAILED', async () => {
      const service = new FilesService(
        runtimeDouble(testConfig({ maxUploadBytes: 1000 })),
      );

      const result = await collectResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/png',
          sizeBytes: 1001,
        }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('should map a storage signing failure to DEPENDENCY_UNAVAILABLE', async () => {
      const runtime = runtimeDouble(testConfig());
      vi.mocked(runtime.createSignedPutUrl).mockRejectedValue(
        new Error('COS credentials invalid'),
      );
      const service = new FilesService(runtime);

      const result = await collectResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/png',
          sizeBytes: 1024,
        }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DEPENDENCY_UNAVAILABLE');
        expect(result.error.kind).toBe('dependency');
      }
    });

    it('should map a storage timeout to DEPENDENCY_TIMEOUT', async () => {
      const runtime = runtimeDouble(testConfig());
      vi.mocked(runtime.createSignedPutUrl).mockRejectedValue(
        Object.assign(new Error('request timed out'), { name: 'TimeoutError' }),
      );
      const service = new FilesService(runtime);

      const result = await collectResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/png',
          sizeBytes: 1024,
        }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DEPENDENCY_TIMEOUT');
      }
    });

    it('should use .jpg extension for image/jpeg content type', async () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime);

      const result = await unwrapResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/jpeg',
          sizeBytes: 1024,
          fileName: 'photo.jpeg',
        }),
      );

      expect(result.objectKey).toMatch(/\.jpg$/);
    });

    it('should fall back to .bin when fileName has no extension', async () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime);

      const result = await unwrapResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/webp',
          sizeBytes: 1024,
          fileName: 'noext',
        }),
      );

      expect(result.objectKey).toMatch(/\.bin$/);
    });

    it('should return null publicUrl when publicBaseUrl is not configured', async () => {
      const service = new FilesService(
        runtimeDouble(testConfig({ publicBaseUrl: '' })),
      );

      const result = await unwrapResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/gif',
          sizeBytes: 1024,
        }),
      );

      expect(result.publicUrl).toBeNull();
    });

    it('should handle mixed-case content type', async () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime);

      const result = await unwrapResult(
        service.createPresignedUpload('user-1', {
          contentType: 'Image/JPEG',
          sizeBytes: 1024,
          fileName: 'photo.jpg',
        }),
      );

      expect(result.headers).toEqual({ 'Content-Type': 'image/jpeg' });
      expect(result.objectKey).toMatch(/\.jpg$/);
    });

    it('should accept sizeBytes of 0', async () => {
      const service = new FilesService(runtimeDouble(testConfig()));

      const result = await unwrapResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/png',
          sizeBytes: 0,
        }),
      );

      expect(result.objectKey).toBeDefined();
    });

    it('should accept file at exact size limit', async () => {
      const runtime = runtimeDouble(testConfig({ maxUploadBytes: 1024 }));
      const service = new FilesService(runtime);

      const result = await unwrapResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/png',
          sizeBytes: 1024,
          fileName: 'exact.png',
        }),
      );

      expect(result.objectKey).toMatch(/\.png$/);
    });

    it('should use .png extension for image/png content type', async () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime);

      const result = await unwrapResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/png',
          sizeBytes: 1024,
          fileName: 'photo.png',
        }),
      );

      expect(result.objectKey).toMatch(/\.png$/);
    });

    it('should use .gif extension for image/gif content type', async () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime);

      const result = await unwrapResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/gif',
          sizeBytes: 1024,
          fileName: 'animation.gif',
        }),
      );

      expect(result.objectKey).toMatch(/\.gif$/);
    });

    it('should return provider from runtime config', async () => {
      const runtime = runtimeDouble(testConfig({ provider: 's3' }));
      const service = new FilesService(runtime);

      const result = await unwrapResult(
        service.createPresignedUpload('user-1', {
          contentType: 'image/png',
          sizeBytes: 1024,
        }),
      );

      expect(result.provider).toBe('s3');
    });
  });
});
