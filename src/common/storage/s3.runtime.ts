import { Injectable, Logger } from '@nestjs/common';
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
import type { S3StorageConfig } from '../../config/services/s3-storage.config.js';
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
  private readonly internalClient: S3Client;
  private readonly clientClient: S3Client;
  private readonly externalClient: S3Client | null;
  private bucketEnsured = false;
  private bucketEnsurePromise: Promise<void> | null = null;

  constructor(configService: ConfigService) {
    super();
    this.config = configService.getOrThrow<S3StorageConfig>(
      ConfigKey.S3Storage,
    );

    const baseConfig = {
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
      forcePathStyle: true,
    };

    this.internalClient = new S3Client({
      ...baseConfig,
      endpoint: this.config.endpoint,
    });

    this.clientClient = new S3Client({
      ...baseConfig,
      endpoint: this.config.clientEndpoint || this.config.endpoint,
    });

    this.externalClient = this.config.externalEndpoint
      ? new S3Client({
          ...baseConfig,
          endpoint: this.config.externalEndpoint,
        })
      : null;
  }

  getConfig(): ObjectStorageConfig {
    return {
      provider: this.provider,
      bucket: this.config.bucket,
      region: this.config.region,
      publicBaseUrl: this.config.publicBaseUrl,
      uploadExpiresSeconds: this.config.uploadExpiresSeconds,
      maxUploadBytes: this.config.maxUploadBytes,
      downloadExpiresSeconds: this.config.downloadExpiresSeconds,
    };
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.endpoint &&
      this.config.accessKey &&
      this.config.secretKey &&
      this.config.bucket,
    );
  }

  async createSignedPutUrl(input: SignedPutUrlInput): Promise<string> {
    return getSignedUrl(
      this.clientClient,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
      }),
      { expiresIn: this.config.uploadExpiresSeconds },
    );
  }

  async createSignedGetUrl(input: SignedGetUrlInput): Promise<string> {
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
          Bucket: this.config.bucket,
          Key: input.objectKey,
        }),
        { expiresIn: this.config.downloadExpiresSeconds },
      );
    }

    return getSignedUrl(
      this.clientClient,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
      }),
      { expiresIn: this.config.downloadExpiresSeconds },
    );
  }

  async uploadBuffer(input: UploadBufferInput): Promise<void> {
    await this.ensureBucket();
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
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
  async ensureBucket(): Promise<void> {
    if (this.bucketEnsured) {
      return;
    }
    if (!this.bucketEnsurePromise) {
      this.bucketEnsurePromise = this.doEnsureBucket();
    }
    await this.bucketEnsurePromise;
  }

  private async doEnsureBucket(): Promise<void> {
    try {
      await this.internalClient.send(
        new HeadBucketCommand({ Bucket: this.config.bucket }),
      );
      this.logger.log(`Bucket "${this.config.bucket}" already exists.`);
    } catch (err: unknown) {
      if (isNotFoundError(err)) {
        this.logger.log(
          `Bucket "${this.config.bucket}" not found, creating...`,
        );
        await this.internalClient.send(
          new CreateBucketCommand({ Bucket: this.config.bucket }),
        );
        this.logger.log(`Bucket "${this.config.bucket}" created.`);
      } else {
        throw err;
      }
    }

    this.bucketEnsured = true;
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
