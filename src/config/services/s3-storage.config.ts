import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum.js';
import { EnvKey } from '../env/env-keys.enum.js';
import { loadYamlConfig } from '../yaml/yaml-loader.js';

export interface S3StorageConfig {
  endpoint: string;
  clientEndpoint: string;
  externalEndpoint: string;
  publicBaseUrl: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
  uploadExpiresSeconds: number;
  maxUploadBytes: number;
  downloadExpiresSeconds: number;
}

export const s3StorageConfig = registerAs(
  ConfigKey.S3Storage,
  (): S3StorageConfig => {
    const yaml = loadYamlConfig();
    const s3 = yaml.storage.s3;

    return {
      endpoint: (process.env[EnvKey.STORAGE_S3_ENDPOINT] ?? s3.endpoint).trim(),
      clientEndpoint: (
        process.env[EnvKey.STORAGE_S3_CLIENT_ENDPOINT] ?? s3.clientEndpoint
      ).trim(),
      externalEndpoint: (
        process.env[EnvKey.STORAGE_S3_EXTERNAL_ENDPOINT] ?? s3.externalEndpoint
      ).trim(),
      publicBaseUrl: (
        process.env[EnvKey.STORAGE_S3_PUBLIC_BASE_URL] ?? s3.publicBaseUrl
      ).trim(),
      // Sensitive — from .env
      accessKey: (process.env[EnvKey.STORAGE_S3_ACCESS_KEY] ?? '').trim(),
      secretKey: (process.env[EnvKey.STORAGE_S3_SECRET_KEY] ?? '').trim(),
      bucket: (process.env[EnvKey.STORAGE_S3_BUCKET] ?? s3.bucket).trim(),
      region: (process.env[EnvKey.STORAGE_S3_REGION] ?? s3.region).trim(),
      uploadExpiresSeconds: Number(
        process.env[EnvKey.STORAGE_S3_UPLOAD_EXPIRES_SECONDS] ??
          s3.uploadExpiresSeconds,
      ),
      maxUploadBytes: Number(
        process.env[EnvKey.STORAGE_S3_MAX_UPLOAD_BYTES] ?? s3.maxUploadBytes,
      ),
      downloadExpiresSeconds: Number(
        process.env[EnvKey.STORAGE_S3_DOWNLOAD_EXPIRES_SECONDS] ??
          s3.downloadExpiresSeconds,
      ),
    };
  },
);
