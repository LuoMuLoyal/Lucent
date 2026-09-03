import { Injectable } from '@nestjs/common';
import { extname } from 'node:path';
import {
  ObjectStorageRuntime,
  createDatePartitionedObjectKey,
} from '../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';

export interface PdfUploadResult {
  objectKey: string;
  bucket: string;
  provider: string;
  fileSizeBytes: number;
}

@Injectable()
export class DataExportStorageService {
  constructor(private readonly runtime: ObjectStorageRuntime) {}

  isConfigured(): boolean {
    return this.runtime.isConfigured();
  }

  /**
   * Uploads a generated PDF to object storage.
   *
   * An unconfigured backend and a failed upload are both dependency failures
   * (`DEPENDENCY_UNAVAILABLE`), never internal errors. Timeout-like failures
   * keep `DEPENDENCY_TIMEOUT`.
   */
  uploadPdf(params: {
    userId: string;
    fileName: string;
    body: Buffer;
  }): ResultAsync<PdfUploadResult, DomainFailure> {
    if (!this.runtime.isConfigured()) {
      return errAsync(this.dependencyUnavailable());
    }

    const objectKey = this.createObjectKey(params.userId, params.fileName);
    return fromPromise(
      this.runtime.uploadBuffer({
        objectKey,
        contentType: 'application/pdf',
        body: params.body,
      }),
      (error) => this.storageFailure(error),
    ).map(() => {
      const config = this.runtime.getConfig();
      return {
        objectKey,
        bucket: config.bucket,
        provider: config.provider,
        fileSizeBytes: params.body.byteLength,
      };
    });
  }

  /**
   * Creates a signed download URL. A missing object key or an unconfigured
   * backend is `null` (success); a failed signing call is a dependency
   * failure.
   */
  createDownloadUrl(
    objectKey: string | null,
  ): ResultAsync<string | null, DomainFailure> {
    if (!objectKey || !this.isConfigured()) {
      return okAsync(null);
    }

    return fromPromise(
      this.runtime.createSignedGetUrl({
        objectKey,
        audience: 'client',
      }),
      (error) => this.storageFailure(error),
    );
  }

  private storageFailure(error: unknown): DomainFailure {
    return createDomainFailure({
      kind: 'dependency',
      code: this.isTimeoutLikeError(error)
        ? 'DEPENDENCY_TIMEOUT'
        : 'DEPENDENCY_UNAVAILABLE',
      cause: error,
    });
  }

  private dependencyUnavailable(): DomainFailure {
    return createDomainFailure({
      kind: 'dependency',
      code: 'DEPENDENCY_UNAVAILABLE',
    });
  }

  private isTimeoutLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return true;
    }
    return error.message.toLowerCase().includes('timeout');
  }

  private createObjectKey(userId: string, fileName: string): string {
    const extension = this.resolveExtension(fileName);
    return createDatePartitionedObjectKey('exports', userId, extension);
  }

  private resolveExtension(fileName: string): string {
    const originalExt = extname(fileName).toLowerCase();
    if (originalExt === '.pdf') {
      return originalExt;
    }

    return '.pdf';
  }
}
