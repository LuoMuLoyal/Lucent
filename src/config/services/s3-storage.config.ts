import { registerAs } from '@nestjs/config';
import { ConfigKey } from '../env/config-keys.enum';
import {
  DEFAULT_COS_MAX_UPLOAD_BYTES,
  DEFAULT_COS_UPLOAD_EXPIRY_SECONDS,
} from '../constants';
import { EnvKey } from '../env/env-keys.enum';

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
  (): S3StorageConfig => ({
    endpoint: process.env[EnvKey.STORAGE_S3_ENDPOINT] ?? '',
    clientEndpoint: process.env[EnvKey.STORAGE_S3_CLIENT_ENDPOINT] ?? '',
    externalEndpoint: process.env[EnvKey.STORAGE_S3_EXTERNAL_ENDPOINT] ?? '',
    publicBaseUrl: process.env[EnvKey.STORAGE_S3_PUBLIC_BASE_URL] ?? '',
    accessKey: process.env[EnvKey.STORAGE_S3_ACCESS_KEY] ?? '',
    secretKey: process.env[EnvKey.STORAGE_S3_SECRET_KEY] ?? '',
    bucket: process.env[EnvKey.STORAGE_S3_BUCKET] ?? '',
    region: process.env[EnvKey.STORAGE_S3_REGION] ?? 'us-east-1',
    uploadExpiresSeconds: Number(
      process.env[EnvKey.STORAGE_S3_UPLOAD_EXPIRES_SECONDS] ??
        DEFAULT_COS_UPLOAD_EXPIRY_SECONDS,
    ),
    maxUploadBytes: Number(
      process.env[EnvKey.STORAGE_S3_MAX_UPLOAD_BYTES] ??
        DEFAULT_COS_MAX_UPLOAD_BYTES,
    ),
    downloadExpiresSeconds: Number(
      process.env[EnvKey.STORAGE_S3_DOWNLOAD_EXPIRES_SECONDS] ??
        DEFAULT_COS_UPLOAD_EXPIRY_SECONDS,
    ),
  }),
);
