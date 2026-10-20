import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigKey } from '../../config/env/config-keys.enum.js';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../config/runtime/runtime-config.types.js';
import type { S3StorageConfig } from '../../config/services/s3-storage.config.js';
import { pickNumber, pickString } from './storage-tunables.js';
import { DomainFailureException } from '../result/domain-failure.exception.js';
import { createDomainFailure } from '../result/domain-failure.js';
import {
  ObjectStorageRuntime,
  type ObjectStorageConfig,
  type SignedGetUrlInput,
  type SignedPutUrlInput,
  type UploadBufferInput,
} from './object-storage.runtime.js';

/**
 * S3-compatible object storage runtime.
 *
 * Uses AWS SDK v3 to talk to any S3-compatible API (SeaweedFS in
 * development).  Maintains three separate `S3Client` instances so
 * that presigned URLs are always signed for the correct endpoint:
 *
 * - **internal** (`STORAGE_S3_ENDPOINT`) — server-side operations
 *   (`uploadBuffer`, `HeadBucket`, `CreateBucket`).
 * - **client** (`STORAGE_S3_CLIENT_ENDPOINT`, falls back to internal)
 *   — presigned PUT/GET URLs returned to the Flutter client.
 * - **external** (`STORAGE_S3_EXTERNAL_ENDPOINT`, optional) —
 *   presigned GET URLs for remote services (e.g. vision models).
 */
@Injectable()
export class S3StorageRuntime extends ObjectStorageRuntime {
  readonly provider = 's3' as const;
  private readonly logger = new Logger(S3StorageRuntime.name);

  private readonly config: S3StorageConfig;
  private internalClient: S3Client;
  private clientClient: S3Client;
  private externalClient: S3Client | null;
  private clientRegion: string;
  private ensuredBucket: string | null = null;
  private bucketEnsurePromise: Promise<void> | null = null;

  constructor(
    configService: ConfigService,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {
    super();
    this.config = configService.getOrThrow<S3StorageConfig>(
      ConfigKey.S3Storage,
    );

    this.clientRegion = this.config.region;
    ({
      internalClient: this.internalClient,
      clientClient: this.clientClient,
      externalClient: this.externalClient,
    } = this.buildClients(this.config.region));
  }

  /**
   * Current settings: bucket, public base, expiry and upload limit come from
   * the snapshot on every call; region is overlaid too, but changing it
   * rebuilds the SDK clients lazily. A bucket/region change affects **new**
   * signed URLs and uploads only — objects already written stay in the old
   * bucket. Credentials and endpoints stay environment-only.
   */
  private settings(): ObjectStorageConfig {
    const values = this.runtimeConfig?.getSnapshot().values;
    const bucket = pickString(
      values?.[EnvKey.STORAGE_S3_BUCKET],
      this.config.bucket,
    );
    return {
      provider: this.provider,
      bucket,
      region: pickString(
        values?.[EnvKey.STORAGE_S3_REGION],
        this.config.region,
      ),
      publicBaseUrl: pickString(
        values?.[EnvKey.STORAGE_S3_PUBLIC_BASE_URL],
        this.config.publicBaseUrl,
      ),
      uploadExpiresSeconds: pickNumber(
        values?.[EnvKey.STORAGE_S3_UPLOAD_EXPIRES_SECONDS],
        this.config.uploadExpiresSeconds,
      ),
      maxUploadBytes: pickNumber(
        values?.[EnvKey.STORAGE_S3_MAX_UPLOAD_BYTES],
        this.config.maxUploadBytes,
      ),
      downloadExpiresSeconds: pickNumber(
        values?.[EnvKey.STORAGE_S3_DOWNLOAD_EXPIRES_SECONDS],
        this.config.downloadExpiresSeconds,
      ),
    };
  }

  private buildClients(region: string): {
    internalClient: S3Client;
    clientClient: S3Client;
    externalClient: S3Client | null;
  } {
    const baseConfig = {
      region,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
      forcePathStyle: true,
    };

    return {
      internalClient: new S3Client({
        ...baseConfig,
        endpoint: this.config.endpoint,
      }),
      clientClient: new S3Client({
        ...baseConfig,
        endpoint: this.config.clientEndpoint || this.config.endpoint,
      }),
      externalClient: this.config.externalEndpoint
        ? new S3Client({
            ...baseConfig,
            endpoint: this.config.externalEndpoint,
          })
        : null,
    };
  }

  /** Rebuilds the clients when a published region differs from the active one. */
  private ensureRegion(region: string): void {
    if (region === this.clientRegion) {
      return;
    }
    const clients = this.buildClients(region);
    this.internalClient = clients.internalClient;
    this.clientClient = clients.clientClient;
    this.externalClient = clients.externalClient;
    this.clientRegion = region;
    this.ensuredBucket = null;
    this.bucketEnsurePromise = null;
  }

  getConfig(): ObjectStorageConfig {
    const settings = this.settings();
    return {
      ...settings,
      publicBaseUrl: this.resolvePublicBaseUrl(
        settings.bucket,
        settings.publicBaseUrl,
      ),
    };
  }

  /**
   * Returns the public base URL **including the bucket path segment**.
   *
   * This runtime sets `forcePathStyle: true`, so an object at key
   * `files/…` is actually served from `{endpoint}/{bucket}/files/…`. A
   * configured base without the bucket segment (e.g.
   * `https://s3.cn-south-1.qiniucs.com`) therefore produced public URLs that
   * 404 — see `docs/TODO.md`'s S3 entry.
   *
   * The bucket is appended here rather than required in the environment
   * variable because path-style addressing is this runtime's own fact: the
   * other providers (`tencent-cos`, `aliyun-oss`) are virtual-host/CDN style,
   * where appending a bucket would be wrong, and `publicBaseUrl` is a shared
   * provider-agnostic field. Keeping the rule next to `forcePathStyle` also
   * means a deployment cannot drift out of sync with the code.
   *
   * Idempotent: a base that already carries the bucket (the workaround
   * previously recorded in the TODO) is left untouched.
   */
  private resolvePublicBaseUrl(bucket: string, publicBaseUrl: string): string {
    const base = publicBaseUrl.trim();
    if (!base || !bucket) return base;

    const trimmed = base.replace(/\/+$/, '');
    // Already bucket-qualified? Compare the final path segment.
    if (trimmed.endsWith(`/${bucket}`)) return trimmed;

    return `${trimmed}/${bucket}`;
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.endpoint &&
      this.config.accessKey &&
      this.config.secretKey &&
      this.settings().bucket,
    );
  }

  async createSignedPutUrl(input: SignedPutUrlInput): Promise<string> {
    const settings = this.settings();
    this.ensureRegion(settings.region);
    return getSignedUrl(
      this.clientClient,
      new PutObjectCommand({
        Bucket: settings.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
      }),
      { expiresIn: settings.uploadExpiresSeconds },
    );
  }

  async createSignedGetUrl(input: SignedGetUrlInput): Promise<string> {
    const settings = this.settings();
    this.ensureRegion(settings.region);
    if (input.audience === 'external') {
      if (this.externalClient == null) {
        throw new DomainFailureException(
          createDomainFailure({
            kind: 'dependency',
            code: 'DEPENDENCY_UNAVAILABLE',
            detail:
              'STORAGE_S3_EXTERNAL_ENDPOINT is not configured; ' +
              'external audience signed URLs are unavailable.',
          }),
        );
      }
      return getSignedUrl(
        this.externalClient,
        new GetObjectCommand({
          Bucket: settings.bucket,
          Key: input.objectKey,
        }),
        { expiresIn: settings.downloadExpiresSeconds },
      );
    }

    return getSignedUrl(
      this.clientClient,
      new GetObjectCommand({
        Bucket: settings.bucket,
        Key: input.objectKey,
      }),
      { expiresIn: settings.downloadExpiresSeconds },
    );
  }

  async uploadBuffer(input: UploadBufferInput): Promise<void> {
    const settings = this.settings();
    this.ensureRegion(settings.region);
    await this.ensureBucket(settings.bucket);
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: settings.bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.body.byteLength,
      }),
    );
  }

  /**
   * Ensures the configured bucket exists.  Runs at most once per
   * runtime instance.  Only `HeadBucket` not-found (404) triggers
   * `CreateBucket`; auth, network and 5xx errors propagate.
   */
  async ensureBucket(bucket: string = this.settings().bucket): Promise<void> {
    if (this.ensuredBucket === bucket) {
      return;
    }
    const pending = this.bucketEnsurePromise;
    if (pending != null) {
      await pending;
      if (this.ensuredBucket === bucket) {
        return;
      }
    }
    this.bucketEnsurePromise = this.doEnsureBucket(bucket);
    await this.bucketEnsurePromise;
  }

  private async doEnsureBucket(bucket: string): Promise<void> {
    try {
      await this.internalClient.send(new HeadBucketCommand({ Bucket: bucket }));
      this.logger.log(`Bucket "${bucket}" already exists.`);
    } catch (err: unknown) {
      if (isNotFoundError(err)) {
        this.logger.log(`Bucket "${bucket}" not found, creating...`);
        await this.internalClient.send(
          new CreateBucketCommand({ Bucket: bucket }),
        );
        this.logger.log(`Bucket "${bucket}" created.`);
      } else {
        throw err;
      }
    }

    this.ensuredBucket = bucket;
  }
}

/**
 * Checks whether an AWS SDK error represents a 404 / NotFound
 * response.  Only these should trigger `CreateBucket`.
 */
function isNotFoundError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') {
    return false;
  }

  const name = (err as { name?: string }).name;
  const httpStatus = (err as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode;

  return name === 'NotFound' || httpStatus === 404;
}
