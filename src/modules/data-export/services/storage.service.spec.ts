import { ServiceUnavailableException } from '@nestjs/common';
import type { TencentCosConfig } from '../../../config/tencent-cos.config';
import type { CosStorageRuntime } from '../../../common';
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
    expect(runtime.uploadBuffer.mock.calls[0]?.[0].contentType).toBe(
      'application/pdf',
    );
    expect(result.provider).toBe('tencent-cos');
    expect(result.bucket).toBe('lucent-test-bucket');
    expect(result.objectKey).toMatch(
      /^exports\/user-1\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]+\.pdf$/,
    );
    expect(result.fileSizeBytes).toBe(Buffer.from('pdf bytes').byteLength);
  });

  it('creates a signed download url when object key exists', () => {
    const runtime = runtimeDouble(testConfig());
    const service = new DataExportStorageService(runtime);

    const result = service.createDownloadUrl('exports/user-1/report.pdf');

    expect(result).toBe('https://signed-download.example.com');
    expect(runtime.createSignedGetUrl).toHaveBeenCalledWith(
      'exports/user-1/report.pdf',
    );
  });

  it('throws when upload is attempted without COS config', async () => {
    const service = new DataExportStorageService(
      runtimeDouble({ ...testConfig(), secretId: '' }),
    );

    await expect(
      service.uploadPdf({
        userId: 'user-1',
        fileName: 'report.pdf',
        body: Buffer.from('pdf'),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

function testConfig(): TencentCosConfig {
  return {
    secretId: 'secret-id',
    secretKey: 'secret-key',
    bucket: 'lucent-test-bucket',
    region: 'ap-guangzhou',
    publicBaseUrl: '',
    uploadExpiresSeconds: 600,
    maxUploadBytes: 10_485_760,
    downloadExpiresSeconds: 600,
  };
}

function runtimeDouble(config: TencentCosConfig): vi.Mocked<CosStorageRuntime> {
  return {
    getConfig: vi.fn().mockReturnValue(config),
    uploadBuffer: vi.fn().mockResolvedValue(undefined),
    createSignedGetUrl: vi
      .fn()
      .mockReturnValue('https://signed-download.example.com'),
  } as unknown as vi.Mocked<CosStorageRuntime>;
}
