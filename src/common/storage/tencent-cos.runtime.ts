import COS from 'cos-nodejs-sdk-v5';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum';
import type { TencentCosConfig } from '../../config/services/tencent-cos.config';
import {
  ObjectStorageRuntime,
  type ObjectStorageConfig,
  type SignedGetUrlInput,
  type SignedPutUrlInput,
  type UploadBufferInput,
} from './object-storage.runtime';

/**
 * Tencent Cloud COS (Cloud Object Storage) runtime.
 *
 * Wraps the `cos-nodejs-sdk-v5` SDK and implements the
 * `ObjectStorageRuntime` abstraction.  Used in production and test/e2e
 * environments (`STORAGE_PROVIDER` unset or `tencent-cos`).
 */
@Injectable()
export class TencentCosStorageRuntime extends ObjectStorageRuntime {
  readonly provider = 'tencent-cos' as const;

  private readonly cos: COS;
  private readonly config: TencentCosConfig;

  constructor(configService: ConfigService) {
    super();
    this.config = configService.getOrThrow<TencentCosConfig>(
      ConfigKey.TencentCos,
    );
    this.cos = new COS({
      SecretId: this.config.secretId,
      SecretKey: this.config.secretKey,
    });
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
      this.config.secretId &&
      this.config.secretKey &&
      this.config.bucket &&
      this.config.region,
    );
  }

  createSignedPutUrl(input: SignedPutUrlInput): Promise<string> {
    return Promise.resolve(
      this.cos.getObjectUrl({
        Bucket: this.config.bucket,
        Region: this.config.region,
        Key: input.objectKey,
        Method: 'PUT',
        Sign: true,
        Expires: this.config.uploadExpiresSeconds,
        Headers: {
          'Content-Type': input.contentType,
        },
      }),
    );
  }

  createSignedGetUrl(input: SignedGetUrlInput): Promise<string> {
    // COS URLs are not audience-specific; both client and external
    // audiences receive the same signed URL.
    return Promise.resolve(
      this.cos.getObjectUrl({
        Bucket: this.config.bucket,
        Region: this.config.region,
        Key: input.objectKey,
        Method: 'GET',
        Sign: true,
        Expires: this.config.downloadExpiresSeconds,
      }),
    );
  }

  async uploadBuffer(input: UploadBufferInput): Promise<void> {
    await this.cos.putObject({
      Bucket: this.config.bucket,
      Region: this.config.region,
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.body.byteLength,
    });
  }
}
