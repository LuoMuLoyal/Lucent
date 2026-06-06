import COS from 'cos-nodejs-sdk-v5';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { TencentCosConfig } from '../../config/tencent-cos.config';
import { DailyRecordImageUploadService } from './daily-record-image-upload.service';

jest.mock('cos-nodejs-sdk-v5');

const mockGetObjectUrl = jest.fn<string, [COS.GetObjectUrlParams]>();
const MockCos = COS as unknown as jest.Mock;

describe('DailyRecordImageUploadService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockCos.mockImplementation(() => ({
      getObjectUrl: mockGetObjectUrl,
    }));
    mockGetObjectUrl.mockReturnValue('https://signed-upload.example.com');
  });

  it('should create a Tencent COS signed upload URL', () => {
    const service = new DailyRecordImageUploadService(
      configService(testConfig()) as ConfigService,
    );

    const result = service.createPresignedUpload('user-1', {
      contentType: 'image/jpeg',
      sizeBytes: 1234,
      fileName: 'breakfast.jpeg',
    });

    expect(MockCos).toHaveBeenCalledWith({
      SecretId: 'secret-id',
      SecretKey: 'secret-key',
    });
    const signedParams = mockGetObjectUrl.mock.calls[0]?.[0];
    if (signedParams == null) {
      throw new Error('Expected getObjectUrl to be called');
    }
    expect(signedParams).toMatchObject({
      Bucket: 'lucent-1250000000',
      Region: 'ap-guangzhou',
      Method: 'PUT',
      Sign: true,
      Expires: 600,
      Headers: {
        'Content-Type': 'image/jpeg',
      },
    });
    expect(signedParams.Key).toMatch(
      /^daily-records\/user-1\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]+\.jpg$/,
    );
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
      configService(testConfig()) as ConfigService,
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
      configService({ ...testConfig(), maxUploadBytes: 1000 }) as ConfigService,
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
      configService({ ...testConfig(), secretId: '' }) as ConfigService,
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
  };
}

function configService(
  config: TencentCosConfig,
): Pick<ConfigService, 'getOrThrow'> {
  return {
    getOrThrow: jest.fn((key: string) => {
      if (key !== 'tencentCos') {
        throw new Error(`Unexpected config key: ${key}`);
      }
      return config;
    }),
  };
}
