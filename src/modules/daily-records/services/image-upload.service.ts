import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { extname } from 'node:path';
import { ALLOWED_IMAGE_TYPES } from '../../../common/constants/mime-types';
import {
  ObjectStorageRuntime,
  type ObjectStorageConfig,
  createDatePartitionedObjectKey,
  buildPublicUrl,
} from '../../../common';
import type { CreateDailyRecordImageUploadDto } from '../dto/candidates/record-image-upload.dto';

@Injectable()
export class DailyRecordImageUploadService {
  constructor(
    private readonly runtime: ObjectStorageRuntime,
    private readonly i18n: I18nService,
  ) {}

  async createPresignedUpload(
    userId: string,
    dto: CreateDailyRecordImageUploadDto,
  ) {
    const config = this.runtime.getConfig();
    this.assertConfigured();

    const contentType = dto.contentType.trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: this.i18n.t('files.content_type_not_allowed'),
      });
    }

    if (dto.sizeBytes > config.maxUploadBytes) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: this.i18n.t('files.file_size_exceeds_limit'),
      });
    }

    const objectKey = this.createObjectKey(userId, dto.fileName, contentType);
    const headers = {
      'Content-Type': contentType,
    };
    const uploadUrl = await this.runtime.createSignedPutUrl({
      objectKey,
      contentType,
    });
    const expiresAt = new Date(
      Date.now() + config.uploadExpiresSeconds * 1000,
    ).toISOString();

    return {
      provider: config.provider,
      bucket: config.bucket,
      objectKey,
      uploadUrl,
      headers,
      publicUrl: this.createPublicUrl(objectKey, config),
      expiresAt,
      maxSizeBytes: config.maxUploadBytes,
    };
  }

  private assertConfigured(): void {
    if (!this.runtime.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Object storage is not configured',
      });
    }
  }

  private createObjectKey(
    userId: string,
    fileName: string | undefined,
    contentType: string,
  ): string {
    const extension = this.resolveExtension(fileName, contentType);
    return createDatePartitionedObjectKey('daily-records', userId, extension);
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

  private createPublicUrl(
    objectKey: string,
    config: ObjectStorageConfig,
  ): string | null {
    return buildPublicUrl(config.publicBaseUrl, objectKey);
  }
}
