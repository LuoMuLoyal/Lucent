import { badRequest } from '../../common/utils/api-errors';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { DailyRecordImageUploadRuntime } from '../daily-records/config/daily-record-image-upload.runtime';
import type { CreateFileUploadDto } from './dto/create-file-upload.dto';

const PROVIDER = 'tencent-cos';
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

@Injectable()
export class FilesService {
  constructor(private readonly runtime: DailyRecordImageUploadRuntime) {}

  createPresignedUpload(userId: string, dto: CreateFileUploadDto) {
    const config = this.runtime.getConfig();

    const contentType = dto.contentType.trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      badRequest('Only jpeg, png, webp, or gif images can be uploaded');
    }

    if (dto.sizeBytes > config.maxUploadBytes) {
      badRequest(
        `Image upload size exceeds ${String(config.maxUploadBytes)} bytes`,
      );
    }

    const ext =
      contentType === 'image/jpeg' ? '.jpg' : extname(dto.fileName ?? '.bin');
    const objectKey = `files/${userId}/${randomUUID()}${ext || '.bin'}`;
    const headers = { 'Content-Type': contentType };
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
      publicUrl: config.publicBaseUrl
        ? `${config.publicBaseUrl.replace(/\/$/, '')}/${objectKey}`
        : null,
      expiresAt,
      maxSizeBytes: config.maxUploadBytes,
    };
  }
}
