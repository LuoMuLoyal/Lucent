import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';
import { loadYamlConfig } from '../yaml/yaml-loader.js';

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
  (): TencentCosConfig => {
    const yaml = loadYamlConfig();
    const cos = yaml.storage.tencentCos;

    return {
      // Sensitive — from .env
      secretId: (process.env[EnvKey.TENCENT_COS_SECRET_ID] ?? '').trim(),
      secretKey: (process.env[EnvKey.TENCENT_COS_SECRET_KEY] ?? '').trim(),
      bucket: (process.env[EnvKey.TENCENT_COS_BUCKET] ?? '').trim(),
      publicBaseUrl: (
        process.env[EnvKey.TENCENT_COS_PUBLIC_BASE_URL] ?? ''
      ).trim(),
      // Non-sensitive — from YAML, overridable by env vars
      region: (process.env[EnvKey.TENCENT_COS_REGION] ?? cos.region).trim(),
      uploadExpiresSeconds: Number(
        process.env[EnvKey.TENCENT_COS_UPLOAD_EXPIRES_SECONDS] ??
          cos.uploadExpiresSeconds,
      ),
      maxUploadBytes: Number(
        process.env[EnvKey.TENCENT_COS_MAX_UPLOAD_BYTES] ?? cos.maxUploadBytes,
      ),
      downloadExpiresSeconds: Number(
        process.env[EnvKey.TENCENT_COS_DOWNLOAD_EXPIRES_SECONDS] ??
          cos.downloadExpiresSeconds,
      ),
    };
  },
);
