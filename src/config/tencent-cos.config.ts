import { registerAs } from '@nestjs/config';
import { ConfigKey } from './config-keys.enum';
import { EnvKey } from './env-keys.enum';

export interface TencentCosConfig {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  publicBaseUrl: string;
  uploadExpiresSeconds: number;
  maxUploadBytes: number;
  downloadExpiresSeconds: number;
}

export const tencentCosConfig = registerAs(
  ConfigKey.TencentCos,
  (): TencentCosConfig => ({
    secretId: process.env[EnvKey.TENCENT_COS_SECRET_ID] ?? '',
    secretKey: process.env[EnvKey.TENCENT_COS_SECRET_KEY] ?? '',
    bucket: process.env[EnvKey.TENCENT_COS_BUCKET] ?? '',
    region: process.env[EnvKey.TENCENT_COS_REGION] ?? '',
    publicBaseUrl: process.env[EnvKey.TENCENT_COS_PUBLIC_BASE_URL] ?? '',
    uploadExpiresSeconds: Number(
      process.env[EnvKey.TENCENT_COS_UPLOAD_EXPIRES_SECONDS] ?? 600,
    ),
    maxUploadBytes: Number(
      process.env[EnvKey.TENCENT_COS_MAX_UPLOAD_BYTES] ?? 10_485_760,
    ),
    downloadExpiresSeconds: Number(
      process.env[EnvKey.TENCENT_COS_DOWNLOAD_EXPIRES_SECONDS] ?? 600,
    ),
  }),
);
