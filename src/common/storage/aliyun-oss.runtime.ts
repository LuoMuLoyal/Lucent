import OSS from 'ali-oss';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum.js';
import type { AliyunOssConfig } from '../../config/services/aliyun-oss.config.js';
import {
  ObjectStorageRuntime,
  type ObjectStorageConfig,
  type SignedGetUrlInput,
  type SignedPutUrlInput,
  type UploadBufferInput,
} from './object-storage.runtime.js';

/**
 * Aliyun OSS (Alibaba Cloud Object Storage Service) runtime.
 *
 * Wraps the `ali-oss` SDK and implements the `ObjectStorageRuntime`
 * abstraction.  Used when `STORAGE_PROVIDER` is set to `ali-oss`.
 *
 * **Note on `audience`**: Aliyun OSS signed URLs are not
 * audience-specific — both client and external audiences receive the
 * same URL.  This differs from `S3StorageRuntime`, which uses separate
 * endpoints.  If external-access differentiation is needed, configure
 * a CDN or public bucket policy at the OSS level.
 */
@Injectable()
export class AliyunOssStorageRuntime extends ObjectStorageRuntime {
  readonly provider = 'ali-oss' as const;
  private readonly logger = new Logger(AliyunOssStorageRuntime.name);

  private readonly oss: OSS;
  private readonly config: AliyunOssConfig;

  constructor(configService: ConfigService) {
    super();
    this.config = configService.getOrThrow<AliyunOssConfig>(
      ConfigKey.AliyunOss,
    );
    this.oss = new OSS({
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint || undefined,
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
      this.config.accessKeyId &&
      this.config.accessKeySecret &&
      this.config.bucket,
    );
  }

  async createSignedPutUrl(input: SignedPutUrlInput): Promise<string> {
    return this.oss.asyncSignatureUrl(input.objectKey, {
      method: 'PUT',
      expires: this.config.uploadExpiresSeconds,
      'Content-Type': input.contentType,
    });
  }

  async createSignedGetUrl(input: SignedGetUrlInput): Promise<string> {
    if (input.audience === 'external') {
      this.logger.warn(
        'Aliyun OSS does not support audience-specific endpoints; ' +
          'external audience will receive the same signed URL as client. ' +
          'Configure a CDN or public bucket policy if external access differentiation is needed.',
      );
    }
    return this.oss.asyncSignatureUrl(input.objectKey, {
      method: 'GET',
      expires: this.config.downloadExpiresSeconds,
    });
  }

  async uploadBuffer(input: UploadBufferInput): Promise<void> {
    await this.oss.put(input.objectKey, input.body, {
      headers: {
        'Content-Type': input.contentType,
        'Content-Length': String(input.body.byteLength),
      },
    });
  }
}
