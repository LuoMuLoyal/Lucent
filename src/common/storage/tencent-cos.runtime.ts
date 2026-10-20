import COS from 'cos-nodejs-sdk-v5';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum.js';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../config/runtime/runtime-config.types.js';
import type { TencentCosConfig } from '../../config/services/tencent-cos.config.js';
import { pickNumber, pickString } from './storage-tunables.js';
import {
  ObjectStorageRuntime,
  type ObjectStorageConfig,
  type SignedGetUrlInput,
  type SignedPutUrlInput,
  type UploadBufferInput,
} from './object-storage.runtime.js';

/**
 * Tencent Cloud COS (Cloud Object Storage) runtime.
 *
 * Wraps the `cos-nodejs-sdk-v5` SDK and implements the
 * `ObjectStorageRuntime` abstraction.  Used in production and test/e2e
 * environments (`STORAGE_PROVIDER` unset or `tencent-cos`).
 *
 * **Note on `audience`**: COS signed URLs are not audience-specific —
 * both client and external audiences receive the same URL.  This
 * differs from `S3StorageRuntime`, which uses separate endpoints.
 * If external-access differentiation is needed, configure a CDN or
 * public bucket policy at the COS level.
 */
@Injectable()
export class TencentCosStorageRuntime extends ObjectStorageRuntime {
  readonly provider = 'tencent-cos' as const;
  private readonly logger = new Logger(TencentCosStorageRuntime.name);

  private readonly cos: COS;
  private readonly config: TencentCosConfig;

  constructor(
    configService: ConfigService,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {
    super();
    this.config = configService.getOrThrow<TencentCosConfig>(
      ConfigKey.TencentCos,
    );
    this.cos = new COS({
      SecretId: this.config.secretId,
      SecretKey: this.config.secretKey,
    });
  }

  /**
   * Current settings: bucket, region, public base and expiry/limit are read
   * from the snapshot on every call, so a publish applies to the next signed
   * URL. A bucket/region change affects **new** URLs only — objects already
   * written stay where they are and existing signed URLs keep working until
   * they expire. Credentials are environment-only.
   */
  private settings(): ObjectStorageConfig {
    const values = this.runtimeConfig?.getSnapshot().values;
    return {
      provider: this.provider,
      bucket: pickString(
        values?.[EnvKey.TENCENT_COS_BUCKET],
        this.config.bucket,
      ),
      region: pickString(
        values?.[EnvKey.TENCENT_COS_REGION],
        this.config.region,
      ),
      publicBaseUrl: pickString(
        values?.[EnvKey.TENCENT_COS_PUBLIC_BASE_URL],
        this.config.publicBaseUrl,
      ),
      uploadExpiresSeconds: pickNumber(
        values?.[EnvKey.TENCENT_COS_UPLOAD_EXPIRES_SECONDS],
        this.config.uploadExpiresSeconds,
      ),
      maxUploadBytes: pickNumber(
        values?.[EnvKey.TENCENT_COS_MAX_UPLOAD_BYTES],
        this.config.maxUploadBytes,
      ),
      downloadExpiresSeconds: pickNumber(
        values?.[EnvKey.TENCENT_COS_DOWNLOAD_EXPIRES_SECONDS],
        this.config.downloadExpiresSeconds,
      ),
    };
  }

  getConfig(): ObjectStorageConfig {
    return this.settings();
  }

  isConfigured(): boolean {
    const settings = this.settings();
    return Boolean(
      this.config.secretId &&
      this.config.secretKey &&
      settings.bucket &&
      settings.region,
    );
  }

  createSignedPutUrl(input: SignedPutUrlInput): Promise<string> {
    const settings = this.settings();
    return Promise.resolve(
      this.cos.getObjectUrl({
        Bucket: settings.bucket,
        Region: settings.region,
        Key: input.objectKey,
        Method: 'PUT',
        Sign: true,
        Expires: settings.uploadExpiresSeconds,
        Headers: {
          'Content-Type': input.contentType,
        },
      }),
    );
  }

  createSignedGetUrl(input: SignedGetUrlInput): Promise<string> {
    if (input.audience === 'external') {
      this.logger.warn(
        'COS does not support audience-specific endpoints; ' +
          'external audience will receive the same signed URL as client. ' +
          'Configure a CDN or public bucket policy if external access differentiation is needed.',
      );
    }
    const settings = this.settings();
    return Promise.resolve(
      this.cos.getObjectUrl({
        Bucket: settings.bucket,
        Region: settings.region,
        Key: input.objectKey,
        Method: 'GET',
        Sign: true,
        Expires: settings.downloadExpiresSeconds,
      }),
    );
  }

  async uploadBuffer(input: UploadBufferInput): Promise<void> {
    const settings = this.settings();
    await this.cos.putObject({
      Bucket: settings.bucket,
      Region: settings.region,
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.body.byteLength,
    });
  }
}
