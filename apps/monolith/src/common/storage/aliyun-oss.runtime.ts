import OSS from 'ali-oss';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum.js';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../config/runtime/runtime-config.types.js';
import type { AliyunOssConfig } from '../../config/services/aliyun-oss.config.js';
import { pickNumber, pickString } from './storage-tunables.js';
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

  private readonly config: AliyunOssConfig;
  private oss: OSS;
  private clientKey: string;

  constructor(
    configService: ConfigService,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {
    super();
    this.config = configService.getOrThrow<AliyunOssConfig>(
      ConfigKey.AliyunOss,
    );
    this.clientKey = this.keyOf(this.config.bucket, this.config.region);
    this.oss = this.buildClient(this.config.bucket, this.config.region);
  }

  /**
   * Current settings: bucket, region, public base and expiry/limit come from
   * the snapshot on every call. The `ali-oss` client binds bucket and region at
   * construction, so a changed pair rebuilds it lazily; objects already
   * written stay in the old bucket and existing URLs keep working until they
   * expire. Credentials and endpoint stay environment-only.
   */
  private settings(): ObjectStorageConfig {
    const values = this.runtimeConfig?.getSnapshot().values;
    return {
      provider: this.provider,
      bucket: pickString(
        values?.[EnvKey.ALIYUN_OSS_BUCKET],
        this.config.bucket,
      ),
      region: pickString(
        values?.[EnvKey.ALIYUN_OSS_REGION],
        this.config.region,
      ),
      publicBaseUrl: pickString(
        values?.[EnvKey.ALIYUN_OSS_PUBLIC_BASE_URL],
        this.config.publicBaseUrl,
      ),
      uploadExpiresSeconds: pickNumber(
        values?.[EnvKey.ALIYUN_OSS_UPLOAD_EXPIRES_SECONDS],
        this.config.uploadExpiresSeconds,
      ),
      maxUploadBytes: pickNumber(
        values?.[EnvKey.ALIYUN_OSS_MAX_UPLOAD_BYTES],
        this.config.maxUploadBytes,
      ),
      downloadExpiresSeconds: pickNumber(
        values?.[EnvKey.ALIYUN_OSS_DOWNLOAD_EXPIRES_SECONDS],
        this.config.downloadExpiresSeconds,
      ),
    };
  }

  private keyOf(bucket: string, region: string): string {
    return `${region}|${bucket}`;
  }

  private buildClient(bucket: string, region: string): OSS {
    return new OSS({
      region,
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      bucket,
      endpoint: this.config.endpoint || undefined,
    });
  }

  private clientFor(settings: ObjectStorageConfig): OSS {
    const key = this.keyOf(settings.bucket, settings.region);
    if (key !== this.clientKey) {
      this.oss = this.buildClient(settings.bucket, settings.region);
      this.clientKey = key;
    }
    return this.oss;
  }

  getConfig(): ObjectStorageConfig {
    return this.settings();
  }

  isConfigured(): boolean {
    const settings = this.settings();
    return Boolean(
      this.config.accessKeyId && this.config.accessKeySecret && settings.bucket,
    );
  }

  async createSignedPutUrl(input: SignedPutUrlInput): Promise<string> {
    const settings = this.settings();
    return this.clientFor(settings).asyncSignatureUrl(input.objectKey, {
      method: 'PUT',
      expires: settings.uploadExpiresSeconds,
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
    const settings = this.settings();
    return this.clientFor(settings).asyncSignatureUrl(input.objectKey, {
      method: 'GET',
      expires: settings.downloadExpiresSeconds,
    });
  }

  async uploadBuffer(input: UploadBufferInput): Promise<void> {
    const settings = this.settings();
    await this.clientFor(settings).put(input.objectKey, input.body, {
      headers: {
        'Content-Type': input.contentType,
        'Content-Length': String(input.body.byteLength),
      },
    });
  }
}
