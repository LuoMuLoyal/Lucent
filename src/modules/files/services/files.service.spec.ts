import { BadRequestException } from '@nestjs/common';
import type { I18nService } from 'nestjs-i18n';
import type { TencentCosConfig } from '../../../config/tencent-cos.config';
import type { CosStorageRuntime } from '../../../common';
import { FilesService } from './files.service';

const mockI18n = {
  t: vi.fn().mockImplementation((key: string) => key),
} as unknown as I18nService;

const mockUuid = '00000000-0000-0000-0000-000000000000';
vi.mock('node:crypto', () => ({
  randomUUID: () => mockUuid,
}));

describe('FilesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function testConfig(overrides?: Partial<TencentCosConfig>): TencentCosConfig {
    return {
      secretId: 'secret-id',
      secretKey: 'secret-key',
      bucket: 'lucent-test-bucket',
      region: 'ap-guangzhou',
      publicBaseUrl: 'https://cdn.example.com/',
      uploadExpiresSeconds: 600,
      maxUploadBytes: 10_485_760,
      downloadExpiresSeconds: 600,
      ...overrides,
    };
  }

  function runtimeDouble(
    config: TencentCosConfig,
  ): vi.Mocked<CosStorageRuntime> {
    const runtime: Pick<
      vi.Mocked<CosStorageRuntime>,
      'getConfig' | 'createSignedPutUrl'
    > = {
      getConfig: vi.fn().mockReturnValue(config),
      createSignedPutUrl: vi
        .fn()
        .mockReturnValue('https://signed-upload.example.com'),
    };

    return runtime as vi.Mocked<CosStorageRuntime>;
  }

  describe('createPresignedUpload', () => {
    it('should create a presigned upload URL for a valid image', () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime, mockI18n);

      const result = service.createPresignedUpload('user-1', {
        contentType: 'image/jpeg',
        sizeBytes: 204800,
        fileName: 'photo.jpg',
      });

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

    it('should reject unsupported content types', () => {
      const service = new FilesService(runtimeDouble(testConfig()), mockI18n);

      expect(() =>
        service.createPresignedUpload('user-1', {
          contentType: 'application/pdf',
          sizeBytes: 1024,
        }),
      ).toThrow(BadRequestException);
    });

    it('should reject empty contentType', () => {
      const service = new FilesService(runtimeDouble(testConfig()), mockI18n);

      expect(() =>
        service.createPresignedUpload('user-1', {
          contentType: '   ',
          sizeBytes: 1024,
        }),
      ).toThrow(BadRequestException);
    });

    it('should reject files exceeding the size limit', () => {
      const service = new FilesService(
        runtimeDouble(testConfig({ maxUploadBytes: 1000 })),
        mockI18n,
      );

      expect(() =>
        service.createPresignedUpload('user-1', {
          contentType: 'image/png',
          sizeBytes: 1001,
        }),
      ).toThrow(BadRequestException);
    });

    it('should use .jpg extension for image/jpeg content type', () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime, mockI18n);

      const result = service.createPresignedUpload('user-1', {
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        fileName: 'photo.jpeg',
      });

      expect(result.objectKey).toMatch(/\.jpg$/);
    });

    it('should fall back to .bin when fileName has no extension', () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime, mockI18n);

      const result = service.createPresignedUpload('user-1', {
        contentType: 'image/webp',
        sizeBytes: 1024,
        fileName: 'noext',
      });

      expect(result.objectKey).toMatch(/\.bin$/);
    });

    it('should return null publicUrl when publicBaseUrl is not configured', () => {
      const service = new FilesService(
        runtimeDouble(testConfig({ publicBaseUrl: '' })),
        mockI18n,
      );

      const result = service.createPresignedUpload('user-1', {
        contentType: 'image/gif',
        sizeBytes: 1024,
      });

      expect(result.publicUrl).toBeNull();
    });

    it('should handle mixed-case content type', () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime, mockI18n);

      const result = service.createPresignedUpload('user-1', {
        contentType: 'Image/JPEG',
        sizeBytes: 1024,
        fileName: 'photo.jpg',
      });

      expect(result.headers).toEqual({ 'Content-Type': 'image/jpeg' });
      expect(result.objectKey).toMatch(/\.jpg$/);
    });

    it('should accept sizeBytes of 0', () => {
      const service = new FilesService(runtimeDouble(testConfig()), mockI18n);

      const result = service.createPresignedUpload('user-1', {
        contentType: 'image/png',
        sizeBytes: 0,
      });

      expect(result.objectKey).toBeDefined();
    });

    it('should accept file at exact size limit', () => {
      const runtime = runtimeDouble(testConfig({ maxUploadBytes: 1024 }));
      const service = new FilesService(runtime, mockI18n);

      const result = service.createPresignedUpload('user-1', {
        contentType: 'image/png',
        sizeBytes: 1024,
        fileName: 'exact.png',
      });

      expect(result.objectKey).toMatch(/\.png$/);
    });

    it('should use .png extension for image/png content type', () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime, mockI18n);

      const result = service.createPresignedUpload('user-1', {
        contentType: 'image/png',
        sizeBytes: 1024,
        fileName: 'photo.png',
      });

      expect(result.objectKey).toMatch(/\.png$/);
    });

    it('should use .gif extension for image/gif content type', () => {
      const runtime = runtimeDouble(testConfig());
      const service = new FilesService(runtime, mockI18n);

      const result = service.createPresignedUpload('user-1', {
        contentType: 'image/gif',
        sizeBytes: 1024,
        fileName: 'animation.gif',
      });

      expect(result.objectKey).toMatch(/\.gif$/);
    });
  });
});
