import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { TencentCosConfig } from '../../../config/tencent-cos.config';
import type { DailyRecordImageUploadRuntime } from '../config/daily-record-image-upload.runtime';
import { DailyRecordImageUploadService } from './daily-record-image-upload.service';

describe('DailyRecordImageUploadService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a Tencent COS signed upload URL', () => {
    const runtime = runtimeDouble(testConfig());
    const service = new DailyRecordImageUploadService(runtime);
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
    expect(result.bucket).toBe('lucent-1250000000');
    expect(result.uploadUrl).toBe('https://signed-upload.example.com');
    expect(result.publicUrl).toMatch(
      /^https:\/\/cdn\.example\.com\/daily-records\/user-1\//,
    );
    expect(result.maxSizeBytes).toBe(10_485_760);
  });

  it('should reject unsupported content types', () => {
    const service = new DailyRecordImageUploadService(
      runtimeDouble(testConfig()),
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
    bucket: 'lucent-1250000000',
    region: 'ap-guangzhou',
    publicBaseUrl: 'https://cdn.example.com/',
    uploadExpiresSeconds: 600,
    maxUploadBytes: 10_485_760,
    downloadExpiresSeconds: 600,
  };
}

function runtimeDouble(
  config: TencentCosConfig,
): jest.Mocked<DailyRecordImageUploadRuntime> {
  const runtime: Pick<
    jest.Mocked<DailyRecordImageUploadRuntime>,
    'getConfig' | 'createSignedPutUrl'
  > = {
    getConfig: jest.fn().mockReturnValue(config),
    createSignedPutUrl: jest
      .fn()
      .mockReturnValue('https://signed-upload.example.com'),
  };

  return runtime as jest.Mocked<DailyRecordImageUploadRuntime>;
}
