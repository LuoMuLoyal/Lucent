import { badRequest } from '../../../common/utils/api-errors';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { ALLOWED_IMAGE_TYPES } from '../../../common/constants/mime-types.constant';
import { ResultCode } from '../../../common/api-envelope';
import { now } from '../../../common/utils/date-time.utils';
import type { CreateDailyRecordImageUploadDto } from '../dto';
import { DailyRecordImageUploadRuntime } from '../config/daily-record-image-upload.runtime';

const PROVIDER = 'tencent-cos';

@Injectable()
export class DailyRecordImageUploadService {
  constructor(
    private readonly runtime: DailyRecordImageUploadRuntime,
    private readonly i18n: I18nService,
  ) {}

  createPresignedUpload(userId: string, dto: CreateDailyRecordImageUploadDto) {
    const config = this.runtime.getConfig();
    this.assertConfigured();

    const contentType = dto.contentType.trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      badRequest(this.i18n.t('files.content_type_not_allowed'));
    }

    if (dto.sizeBytes > config.maxUploadBytes) {
      badRequest(this.i18n.t('files.file_size_exceeds_limit'));
    }

    const objectKey = this.createObjectKey(userId, dto.fileName, contentType);
    const headers = {
      'Content-Type': contentType,
    };
    const uploadUrl = this.runtime.createSignedPutUrl({
      objectKey,
      contentType,
    });
    const expiresAt = new Date(
      Date.now() + config.uploadExpiresSeconds * 1000,
    ).toISOString();

    return {
      provider: PROVIDER,
      bucket: config.bucket,
      objectKey,
      uploadUrl,
      headers,
      publicUrl: this.createPublicUrl(objectKey),
      expiresAt,
      maxSizeBytes: config.maxUploadBytes,
    };
  }

  private assertConfigured(): void {
    const config = this.runtime.getConfig();
    if (
      !config.secretId ||
      !config.secretKey ||
      !config.bucket ||
      !config.region
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
    const currentTime = now();
    const year = String(currentTime.getUTCFullYear());
    const month = String(currentTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(currentTime.getUTCDate()).padStart(2, '0');
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
    const baseUrl = this.runtime.getConfig().publicBaseUrl.trim();
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
