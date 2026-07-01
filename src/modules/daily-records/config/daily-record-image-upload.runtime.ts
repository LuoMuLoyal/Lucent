import COS from 'cos-nodejs-sdk-v5';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../../config/config-keys.enum';
import type { TencentCosConfig } from '../../../config/tencent-cos.config';

@Injectable()
export class DailyRecordImageUploadRuntime {
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
}
