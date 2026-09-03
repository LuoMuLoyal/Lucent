import { extname } from 'node:path';

import { Injectable } from '@nestjs/common';

import { ALLOWED_IMAGE_TYPES } from '../../../common/constants/mime-types.js';
import {
  ObjectStorageRuntime,
  createFlatObjectKey,
  buildPublicUrl,
} from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import type { CreateFileUploadDto } from '../dto/create-file-upload.dto.js';

/** Successful presigned-upload payload returned to the client. */
export interface CreatePresignedUploadResult {
  provider: string;
  bucket: string;
  objectKey: string;
  uploadUrl: string;
  headers: { 'Content-Type': string };
  publicUrl: string | null;
  expiresAt: string;
  maxSizeBytes: number;
}

@Injectable()
export class FilesService {
  constructor(private readonly runtime: ObjectStorageRuntime) {}

  /**
   * Creates a presigned upload URL for a client file.
   *
   * Client-supplied content is validated first; unsupported MIME types and
   * sizes above the configured cap are `VALIDATION_FAILED` (400). Signing is
   * delegated to the configured object-storage backend — a failed signing
   * call is a dependency failure (`DEPENDENCY_UNAVAILABLE` / timeout), never
   * an internal error.
   */
  createPresignedUpload(
    userId: string,
    dto: CreateFileUploadDto,
  ): ResultAsync<CreatePresignedUploadResult, DomainFailure> {
    const config = this.runtime.getConfig();

    const contentType = dto.contentType.trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return errAsync(this.validationFailed());
    }

    if (dto.sizeBytes > config.maxUploadBytes) {
      return errAsync(this.validationFailed());
    }

    const ext =
      contentType === 'image/jpeg' ? '.jpg' : extname(dto.fileName ?? '.bin');
    const objectKey = createFlatObjectKey('files', userId, ext || '.bin');
    const headers = { 'Content-Type': contentType };

    return fromPromise(
      this.runtime.createSignedPutUrl({ objectKey, contentType }),
      (error) => this.storageFailure(error),
    ).map((uploadUrl) => {
      const expiresAt = new Date(
        Date.now() + config.uploadExpiresSeconds * 1000,
      ).toISOString();

      return {
        provider: config.provider,
        bucket: config.bucket,
        objectKey,
        uploadUrl,
        headers,
        publicUrl: buildPublicUrl(config.publicBaseUrl, objectKey),
        expiresAt,
        maxSizeBytes: config.maxUploadBytes,
      };
    });
  }

  private validationFailed(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }

  /**
   * Classifies a failed storage-backend call. Timeout-like errors keep
   * `DEPENDENCY_TIMEOUT`; anything else (credentials, connectivity, backend
   * rejection) is `DEPENDENCY_UNAVAILABLE`. The raw error only goes to
   * `cause` for logs/OTel — never into the response body.
   */
  private storageFailure(error: unknown): DomainFailure {
    return createDomainFailure({
      kind: 'dependency',
      code: this.isTimeoutLikeError(error)
        ? 'DEPENDENCY_TIMEOUT'
        : 'DEPENDENCY_UNAVAILABLE',
      cause: error,
    });
  }

  private isTimeoutLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return true;
    }
    return error.message.toLowerCase().includes('timeout');
  }
}
