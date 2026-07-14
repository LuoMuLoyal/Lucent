import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { TencentCosConfig } from '../../../config/tencent-cos.config';
import type { CosStorageRuntime } from '../../../common/storage';
import type { I18nService } from 'nestjs-i18n';
import { DailyRecordImageUploadService } from './image-upload.service';

const mockI18n = {
  t: vi.fn().mockReturnValue('error'),
} as unknown as I18nService;

describe('DailyRecordImageUploadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a Tencent COS signed upload URL', () => {
    const runtime = runtimeDouble(testConfig());
    const service = new DailyRecordImageUploadService(runtime, mockI18n);
    const expectedObjectKeyPattern =
      /^daily-records\/user-1\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]+\.jpg$/;

    const result = service.createPresignedUpload('user-1', {
      contentType: 'image/jpeg',
      sizeBytes: 1234,
      fileName: 'breakfast.jpeg',
    });
    const signedPutArgs = runtime.createSignedPutUrl.mock.calls[0]?.[0];

    expect(runtime.createSignedPutUrl).toHaveBeenCalledTimes(1);
    expect(signedPutArgs).toBeDefined();
    expect(signedPutArgs?.contentType).toBe('image/jpeg');
    expect(signedPutArgs?.objectKey).toMatch(expectedObjectKeyPattern);
    expect(result.provider).toBe('tencent-cos');
    expect(result.bucket).toBe('lucent-test-bucket');
    expect(result.uploadUrl).toBe('https://signed-upload.example.com');
    expect(result.publicUrl).toMatch(
      /^https:\/\/cdn\.example\.com\/daily-records\/user-1\//,
    );
    expect(result.maxSizeBytes).toBe(10_485_760);
  });

  it('should reject unsupported content types', () => {
    const service = new DailyRecordImageUploadService(
      runtimeDouble(testConfig()),
      mockI18n,
    );

    expect(() =>
      service.createPresignedUpload('user-1', {
        contentType: 'application/pdf',
        sizeBytes: 1234,
      }),
    ).toThrow(BadRequestException);
  });

  it('should reject images larger than configured limit', () => {
    const service = new DailyRecordImageUploadService(
      runtimeDouble({ ...testConfig(), maxUploadBytes: 1000 }),
      mockI18n,
    );

    expect(() =>
      service.createPresignedUpload('user-1', {
        contentType: 'image/png',
        sizeBytes: 1001,
      }),
    ).toThrow(BadRequestException);
  });

  it('should fail when Tencent COS is not configured', () => {
    const service = new DailyRecordImageUploadService(
      runtimeDouble({ ...testConfig(), secretId: '' }),
      mockI18n,
    );

    expect(() =>
      service.createPresignedUpload('user-1', {
        contentType: 'image/png',
        sizeBytes: 1000,
      }),
    ).toThrow(ServiceUnavailableException);
  });
});

function testConfig(): TencentCosConfig {
  return {
    secretId: 'secret-id',
    secretKey: 'secret-key',
    bucket: 'lucent-test-bucket',
    region: 'ap-guangzhou',
    publicBaseUrl: 'https://cdn.example.com/',
    uploadExpiresSeconds: 600,
    maxUploadBytes: 10_485_760,
    downloadExpiresSeconds: 600,
  };
}

function runtimeDouble(config: TencentCosConfig): vi.Mocked<CosStorageRuntime> {
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
