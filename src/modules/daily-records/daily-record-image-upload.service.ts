import COS from 'cos-nodejs-sdk-v5';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { ResultCode } from '../../common/api-envelope';
import { ConfigKey } from '../../config/config-keys.enum';
import type { TencentCosConfig } from '../../config/tencent-cos.config';
import type { CreateDailyRecordImageUploadDto } from './dto';

const PROVIDER = 'tencent-cos';
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

@Injectable()
export class DailyRecordImageUploadService {
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

  createPresignedUpload(userId: string, dto: CreateDailyRecordImageUploadDto) {
    this.assertConfigured();

    const contentType = dto.contentType.trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new BadRequestException({
        code: ResultCode.BAD_REQUEST,
        message: 'Only jpeg, png, webp, or gif images can be uploaded',
      });
    }

    if (dto.sizeBytes > this.config.maxUploadBytes) {
      throw new BadRequestException({
        code: ResultCode.BAD_REQUEST,
        message: `Image upload size exceeds ${String(this.config.maxUploadBytes)} bytes`,
      });
    }

    const objectKey = this.createObjectKey(userId, dto.fileName, contentType);
    const headers = {
      'Content-Type': contentType,
    };
    const uploadUrl = this.cos.getObjectUrl({
      Bucket: this.config.bucket,
      Region: this.config.region,
      Key: objectKey,
      Method: 'PUT',
      Sign: true,
      Expires: this.config.uploadExpiresSeconds,
      Headers: headers,
    });
    const expiresAt = new Date(
      Date.now() + this.config.uploadExpiresSeconds * 1000,
    ).toISOString();

    return {
      provider: PROVIDER,
      bucket: this.config.bucket,
      objectKey,
      uploadUrl,
      headers,
      publicUrl: this.createPublicUrl(objectKey),
      expiresAt,
      maxSizeBytes: this.config.maxUploadBytes,
    };
  }

  private assertConfigured(): void {
    if (
      !this.config.secretId ||
      !this.config.secretKey ||
      !this.config.bucket ||
      !this.config.region
    ) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: 'Tencent COS upload is not configured',
      });
    }
  }

  private createObjectKey(
    userId: string,
    fileName: string | undefined,
    contentType: string,
  ): string {
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const extension = this.resolveExtension(fileName, contentType);

    return `daily-records/${userId}/${year}/${month}/${day}/${randomUUID()}${extension}`;
  }

  private resolveExtension(
    fileName: string | undefined,
    contentType: string,
  ): string {
    const originalExt = extname(fileName ?? '').toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(originalExt)) {
      return originalExt === '.jpeg' ? '.jpg' : originalExt;
    }

    switch (contentType) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      case 'image/gif':
        return '.gif';
      default:
        return '';
    }
  }

  private createPublicUrl(objectKey: string): string | null {
    const baseUrl = this.config.publicBaseUrl.trim();
    if (!baseUrl) {
      return null;
    }

    return `${baseUrl.replace(/\/+$/, '')}/${encodeObjectKey(objectKey)}`;
  }
}

function encodeObjectKey(objectKey: string): string {
  return objectKey
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}
