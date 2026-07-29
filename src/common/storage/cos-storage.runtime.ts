import COS from 'cos-nodejs-sdk-v5';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum';
import type { TencentCosConfig } from '../../config/services/tencent-cos.config';

/**
 * Shared Tencent COS (Cloud Object Storage) runtime.
 *
 * Consolidates all COS operations (signed PUT/GET URLs, buffer upload)
 * into a single injectable so that feature modules (`files`,
 * `daily-records`, `data-export`, …) never need to create their own
 * COS client or depend on another module's config.
 */
@Injectable()
export class CosStorageRuntime {
  private readonly cos: COS;
  private readonly config: TencentCosConfig;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<TencentCosConfig>(
      ConfigKey.TencentCos,
    );
    this.cos = new COS({
      SecretId: this.config.secretId,
      SecretKey: this.config.secretKey,
    });
  }

  getConfig(): TencentCosConfig {
    return this.config;
  }

  createSignedPutUrl(params: {
    objectKey: string;
    contentType: string;
  }): string {
    return this.cos.getObjectUrl({
      Bucket: this.config.bucket,
      Region: this.config.region,
      Key: params.objectKey,
      Method: 'PUT',
      Sign: true,
      Expires: this.config.uploadExpiresSeconds,
      Headers: {
        'Content-Type': params.contentType,
      },
    });
  }

  createSignedGetUrl(objectKey: string): string {
    return this.cos.getObjectUrl({
      Bucket: this.config.bucket,
      Region: this.config.region,
      Key: objectKey,
      Method: 'GET',
      Sign: true,
      Expires: this.config.downloadExpiresSeconds,
    });
  }

  async uploadBuffer(params: {
    objectKey: string;
    contentType: string;
    body: Buffer;
  }): Promise<void> {
    await this.cos.putObject({
      Bucket: this.config.bucket,
      Region: this.config.region,
      Key: params.objectKey,
      Body: params.body,
      ContentType: params.contentType,
      ContentLength: params.body.byteLength,
    });
  }
}
