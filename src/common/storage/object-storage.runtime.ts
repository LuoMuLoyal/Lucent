/**
 * Abstract object-storage runtime — the single DI token used by all
 * feature modules that need signed URLs or buffer uploads.
 *
 * Concrete implementations:
 * - `TencentCosStorageRuntime` (production / test)
 * - `S3StorageRuntime`          (development with SeaweedFS)
 *
 * The `StorageModule` binds exactly one implementation to this abstract
 * token based on the `STORAGE_PROVIDER` environment variable.
 */

/** Audience for a signed GET URL. */
export type SignedUrlAudience = 'client' | 'external';

/** Provider identifier returned in API responses. */
export type StorageProvider = 'tencent-cos' | 's3';

/**
 * Provider-agnostic configuration surface consumed by feature modules.
 *
 * Each concrete runtime maps its own config type into this shape so
 * that business services never read `TencentCosConfig` or
 * `S3StorageConfig` directly.
 */
export interface ObjectStorageConfig {
  provider: StorageProvider;
  bucket: string;
  region: string;
  publicBaseUrl: string;
  uploadExpiresSeconds: number;
  maxUploadBytes: number;
  downloadExpiresSeconds: number;
}

export interface SignedPutUrlInput {
  objectKey: string;
  contentType: string;
}

export interface SignedGetUrlInput {
  objectKey: string;
  audience: SignedUrlAudience;
}

export interface UploadBufferInput {
  objectKey: string;
  contentType: string;
  body: Buffer;
}

/**
 * Nest DI token. Use `@Inject(ObjectStorageRuntime)` in constructors.
 */
export abstract class ObjectStorageRuntime {
  abstract readonly provider: StorageProvider;

  abstract getConfig(): ObjectStorageConfig;

  abstract isConfigured(): boolean;

  abstract createSignedPutUrl(input: SignedPutUrlInput): Promise<string>;

  abstract createSignedGetUrl(input: SignedGetUrlInput): Promise<string>;

  abstract uploadBuffer(input: UploadBufferInput): Promise<void>;
}
