import type {
  ObjectStorageConfig,
  ObjectStorageRuntime,
} from '../../../common/index.js';
import type {
  ResultAsync,
  DomainFailure,
} from '../../../common/result/index.js';
import { DataExportStorageService } from './storage.service.js';

/** Folds a ResultAsync into a plain outcome so specs can assert code/value. */
async function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

/** Unwraps a ResultAsync, failing the test when it is an Err. */
async function unwrapOk<T>(result: ResultAsync<T, DomainFailure>): Promise<T> {
  const outcome = await collectResult(result);
  if (!outcome.ok) {
    throw new Error(`Expected ok result, got ${outcome.error.code}`);
  }
  return outcome.value;
}

describe('DataExportStorageService', () => {
  it('uploads a pdf and returns object metadata', async () => {
    const runtime = runtimeDouble(testConfig());
    const service = new DataExportStorageService(runtime);

    const result = await unwrapOk(
      service.uploadPdf({
        userId: 'user-1',
        fileName: 'report.pdf',
        body: Buffer.from('pdf bytes'),
      }),
    );

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

    const result = await unwrapOk(
      service.createDownloadUrl('exports/user-1/report.pdf'),
    );

    expect(result).toBe('https://signed-download.example.com');
    expect(runtime.createSignedGetUrl).toHaveBeenCalledWith({
      objectKey: 'exports/user-1/report.pdf',
      audience: 'client',
    });
  });

  it('returns null when object key is null', async () => {
    const runtime = runtimeDouble(testConfig());
    const service = new DataExportStorageService(runtime);

    const result = await unwrapOk(service.createDownloadUrl(null));

    expect(result).toBeNull();
  });

  it('returns DEPENDENCY_UNAVAILABLE when upload is attempted without storage config', async () => {
    const service = new DataExportStorageService(
      runtimeDouble(testConfig(), false),
    );

    const outcome = await collectResult(
      service.uploadPdf({
        userId: 'user-1',
        fileName: 'report.pdf',
        body: Buffer.from('pdf'),
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(outcome.error.kind).toBe('dependency');
  });

  it('maps a runtime upload failure to DEPENDENCY_UNAVAILABLE', async () => {
    const runtime = runtimeDouble(testConfig());
    vi.mocked(runtime.uploadBuffer).mockRejectedValue(
      new Error('COS putObject failed'),
    );
    const service = new DataExportStorageService(runtime);

    const outcome = await collectResult(
      service.uploadPdf({
        userId: 'user-1',
        fileName: 'report.pdf',
        body: Buffer.from('pdf'),
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(outcome.error.kind).toBe('dependency');
  });

  it('maps a timeout-like upload failure to DEPENDENCY_TIMEOUT', async () => {
    const runtime = runtimeDouble(testConfig());
    vi.mocked(runtime.uploadBuffer).mockRejectedValue(
      Object.assign(new Error('request timed out'), { name: 'TimeoutError' }),
    );
    const service = new DataExportStorageService(runtime);

    const outcome = await collectResult(
      service.uploadPdf({
        userId: 'user-1',
        fileName: 'report.pdf',
        body: Buffer.from('pdf'),
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('DEPENDENCY_TIMEOUT');
  });

  it('returns provider from runtime config', async () => {
    const runtime = runtimeDouble({ ...testConfig(), provider: 's3' });
    const service = new DataExportStorageService(runtime);

    const result = await unwrapOk(
      service.uploadPdf({
        userId: 'user-1',
        fileName: 'report.pdf',
        body: Buffer.from('pdf bytes'),
      }),
    );

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
