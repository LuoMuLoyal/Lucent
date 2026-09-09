import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';

export interface AliyunOssConfig {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  endpoint: string;
  publicBaseUrl: string;
  uploadExpiresSeconds: number;
  maxUploadBytes: number;
  downloadExpiresSeconds: number;
}

export const aliyunOssConfig = registerAs(
  ConfigKey.AliyunOss,
  (): AliyunOssConfig => {
    return {
      // Sensitive — from .env
      accessKeyId: (process.env[EnvKey.ALIYUN_OSS_ACCESS_KEY_ID] ?? '').trim(),
      accessKeySecret: (
        process.env[EnvKey.ALIYUN_OSS_ACCESS_KEY_SECRET] ?? ''
      ).trim(),
      bucket: (process.env[EnvKey.ALIYUN_OSS_BUCKET] ?? '').trim(),
      publicBaseUrl: (
        process.env[EnvKey.ALIYUN_OSS_PUBLIC_BASE_URL] ?? ''
      ).trim(),
      region: (process.env[EnvKey.ALIYUN_OSS_REGION] ?? '').trim(),
      endpoint: (process.env[EnvKey.ALIYUN_OSS_ENDPOINT] ?? '').trim(),
      uploadExpiresSeconds: Number(
        process.env[EnvKey.ALIYUN_OSS_UPLOAD_EXPIRES_SECONDS],
      ),
      maxUploadBytes: Number(process.env[EnvKey.ALIYUN_OSS_MAX_UPLOAD_BYTES]),
      downloadExpiresSeconds: Number(
        process.env[EnvKey.ALIYUN_OSS_DOWNLOAD_EXPIRES_SECONDS],
      ),
    };
  },
);
