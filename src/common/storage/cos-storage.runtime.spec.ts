import type { ConfigService } from '@nestjs/config';
import type { TencentCosConfig } from '../../config/services/tencent-cos.config';
import { CosStorageRuntime } from './cos-storage.runtime';

const mockCos = {
  getObjectUrl: vi.fn(),
  putObject: vi.fn(),
};

vi.mock('cos-nodejs-sdk-v5', () => ({
  __esModule: true,
  default: vi.fn(function () {
    return mockCos;
  }),
}));

import COS from 'cos-nodejs-sdk-v5';

function buildConfig(
  overrides: Partial<TencentCosConfig> = {},
): TencentCosConfig {
  return {
    secretId: 'test-secret-id',
    secretKey: 'test-secret-key',
    bucket: 'test-bucket',
    region: 'ap-guangzhou',
    publicBaseUrl: 'https://cdn.example.com',
    uploadExpiresSeconds: 600,
    maxUploadBytes: 10_485_760,
    downloadExpiresSeconds: 600,
    ...overrides,
  };
}

function buildConfigService(config: TencentCosConfig): ConfigService {
  return {
    getOrThrow: vi.fn().mockReturnValue(config),
  } as unknown as ConfigService;
}

const cosMock = COS as unknown as vi.Mock;

describe('CosStorageRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a COS client with secretId and secretKey from config', () => {
    const config = buildConfig();
    const configService = buildConfigService(config);

    new CosStorageRuntime(configService);

    expect(cosMock).toHaveBeenCalledWith({
      SecretId: 'test-secret-id',
      SecretKey: 'test-secret-key',
    });
  });

  it('getConfig() returns the resolved config', () => {
    const config = buildConfig({ bucket: 'my-bucket' });
    const configService = buildConfigService(config);

    const runtime = new CosStorageRuntime(configService);

    expect(runtime.getConfig()).toBe(config);
  });

  it('createSignedPutUrl delegates to cos.getObjectUrl with PUT method', () => {
    const config = buildConfig({
      bucket: 'put-bucket',
      region: 'us-east',
      uploadExpiresSeconds: 300,
    });
    const configService = buildConfigService(config);
    mockCos.getObjectUrl.mockReturnValue('https://signed-put-url.example.com');

    const runtime = new CosStorageRuntime(configService);
    const url = runtime.createSignedPutUrl({
      objectKey: 'uploads/test-file.png',
      contentType: 'image/png',
    });

    expect(url).toBe('https://signed-put-url.example.com');
    expect(mockCos.getObjectUrl).toHaveBeenCalledWith({
      Bucket: 'put-bucket',
      Region: 'us-east',
      Key: 'uploads/test-file.png',
      Method: 'PUT',
      Sign: true,
      Expires: 300,
      Headers: {
        'Content-Type': 'image/png',
      },
    });
  });

  it('createSignedGetUrl delegates to cos.getObjectUrl with GET method', () => {
    const config = buildConfig({
      bucket: 'get-bucket',
      region: 'eu-west',
      downloadExpiresSeconds: 180,
    });
    const configService = buildConfigService(config);
    mockCos.getObjectUrl.mockReturnValue('https://signed-get-url.example.com');

    const runtime = new CosStorageRuntime(configService);
    const url = runtime.createSignedGetUrl('downloads/report.pdf');

    expect(url).toBe('https://signed-get-url.example.com');
    expect(mockCos.getObjectUrl).toHaveBeenCalledWith({
      Bucket: 'get-bucket',
      Region: 'eu-west',
      Key: 'downloads/report.pdf',
      Method: 'GET',
      Sign: true,
      Expires: 180,
    });
  });

  it('uploadBuffer calls cos.putObject with buffer and metadata', async () => {
    const config = buildConfig({
      bucket: 'upload-bucket',
      region: 'ap-shanghai',
    });
    const configService = buildConfigService(config);
    mockCos.putObject.mockResolvedValue({});

    const runtime = new CosStorageRuntime(configService);
    const buffer = Buffer.from('test file content');

    await runtime.uploadBuffer({
      objectKey: 'files/test.txt',
      contentType: 'text/plain',
      body: buffer,
    });

    expect(mockCos.putObject).toHaveBeenCalledWith({
      Bucket: 'upload-bucket',
      Region: 'ap-shanghai',
      Key: 'files/test.txt',
      Body: buffer,
      ContentType: 'text/plain',
      ContentLength: buffer.byteLength,
    });
  });

  it('propagates errors from cos.putObject', async () => {
    const config = buildConfig();
    const configService = buildConfigService(config);
    mockCos.putObject.mockRejectedValue(new Error('COS upload failed'));

    const runtime = new CosStorageRuntime(configService);

    await expect(
      runtime.uploadBuffer({
        objectKey: 'files/test.txt',
        contentType: 'text/plain',
        body: Buffer.from('content'),
      }),
    ).rejects.toThrow('COS upload failed');
  });
});
