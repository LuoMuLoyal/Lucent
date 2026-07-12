import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { ALLOWED_IMAGE_TYPES } from '../../../common/constants/mime-types';
import { badRequest } from '../../../common/helpers/api-errors';
import { CosStorageRuntime } from '../../../common/storage';
import type { CreateFileUploadDto } from '../dto/create-file-upload.dto';

const PROVIDER = 'tencent-cos';

@Injectable()
export class FilesService {
  constructor(
    private readonly runtime: CosStorageRuntime,
    private readonly i18n: I18nService,
  ) {}

  createPresignedUpload(userId: string, dto: CreateFileUploadDto) {
    const config = this.runtime.getConfig();

    const contentType = dto.contentType.trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      badRequest(this.i18n.t('files.content_type_not_allowed'));
    }

    if (dto.sizeBytes > config.maxUploadBytes) {
      badRequest(this.i18n.t('files.file_size_exceeds_limit'));
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
