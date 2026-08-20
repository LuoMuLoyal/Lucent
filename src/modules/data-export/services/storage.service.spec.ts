import { ServiceUnavailableException } from '@nestjs/common';
import type {
  ObjectStorageConfig,
  ObjectStorageRuntime,
} from '../../../common';
import { DataExportStorageService } from './storage.service';

describe('DataExportStorageService', () => {
  it('uploads a pdf and returns object metadata', async () => {
    const runtime = runtimeDouble(testConfig());
    const service = new DataExportStorageService(runtime);

    const result = await service.uploadPdf({
      userId: 'user-1',
      fileName: 'report.pdf',
      body: Buffer.from('pdf bytes'),
    });

    expect(runtime.uploadBuffer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runtime.uploadBuffer).mock.calls[0]?.[0].contentType).toBe(
      'application/pdf',
    );
    expect(result.provider).toBe('tencent-cos');
    expect(result.bucket).toBe('lucent-test-bucket');
    expect(result.objectKey).toMatch(
      /^exports\/user-1\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]+\.pdf$/,
    );
    expect(result.fileSizeBytes).toBe(Buffer.from('pdf bytes').byteLength);
  });

  it('creates a signed download url when object key exists', async () => {
    const runtime = runtimeDouble(testConfig());
    const service = new DataExportStorageService(runtime);

    const result = await service.createDownloadUrl('exports/user-1/report.pdf');

    expect(result).toBe('https://signed-download.example.com');
    expect(runtime.createSignedGetUrl).toHaveBeenCalledWith({
      objectKey: 'exports/user-1/report.pdf',
      audience: 'client',
    });
  });

  it('returns null when object key is null', async () => {
    const runtime = runtimeDouble(testConfig());
    const service = new DataExportStorageService(runtime);

    const result = await service.createDownloadUrl(null);

    expect(result).toBeNull();
  });

  it('throws when upload is attempted without storage config', async () => {
    const service = new DataExportStorageService(
      runtimeDouble(testConfig(), false),
    );

    await expect(
      service.uploadPdf({
        userId: 'user-1',
        fileName: 'report.pdf',
        body: Buffer.from('pdf'),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns provider from runtime config', async () => {
    const runtime = runtimeDouble({ ...testConfig(), provider: 's3' });
    const service = new DataExportStorageService(runtime);

    const result = await service.uploadPdf({
      userId: 'user-1',
      fileName: 'report.pdf',
      body: Buffer.from('pdf bytes'),
    });

    expect(result.provider).toBe('s3');
  });
});

function testConfig(): ObjectStorageConfig {
  return {
    provider: 'tencent-cos',
    bucket: 'lucent-test-bucket',
    region: 'ap-guangzhou',
    publicBaseUrl: '',
    uploadExpiresSeconds: 600,
    maxUploadBytes: 10_485_760,
    downloadExpiresSeconds: 600,
  };
}

function runtimeDouble(
  config: ObjectStorageConfig,
  configured = true,
): ObjectStorageRuntime {
  return {
    provider: config.provider,
    getConfig: vi.fn().mockReturnValue(config),
    uploadBuffer: vi.fn().mockResolvedValue(undefined),
    createSignedGetUrl: vi
      .fn()
      .mockResolvedValue('https://signed-download.example.com'),
    createSignedPutUrl: vi
      .fn()
      .mockResolvedValue('https://signed-upload.example.com'),
    isConfigured: vi.fn().mockReturnValue(configured),
  } as unknown as ObjectStorageRuntime;
}
