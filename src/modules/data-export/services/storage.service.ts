import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { extname } from 'node:path';
import {
  ResultCode,
  ObjectStorageRuntime,
  createDatePartitionedObjectKey,
} from '../../../common';

@Injectable()
export class DataExportStorageService {
  constructor(private readonly runtime: ObjectStorageRuntime) {}

  isConfigured(): boolean {
    return this.runtime.isConfigured();
  }

  async uploadPdf(params: {
    userId: string;
    fileName: string;
    body: Buffer;
  }): Promise<{
    objectKey: string;
    bucket: string;
    provider: string;
    fileSizeBytes: number;
  }> {
    this.assertConfigured();

    const objectKey = this.createObjectKey(params.userId, params.fileName);
    await this.runtime.uploadBuffer({
      objectKey,
      contentType: 'application/pdf',
      body: params.body,
    });

    const config = this.runtime.getConfig();
    return {
      objectKey,
      bucket: config.bucket,
      provider: config.provider,
      fileSizeBytes: params.body.byteLength,
    };
  }

  async createDownloadUrl(objectKey: string | null): Promise<string | null> {
    if (!objectKey || !this.isConfigured()) {
      return null;
    }

    return this.runtime.createSignedGetUrl({
      objectKey,
      audience: 'client',
    });
  }

  private assertConfigured(): void {
    if (!this.runtime.isConfigured()) {
      throw new ServiceUnavailableException({
        code: ResultCode.EXTERNAL_SERVICE_ERROR,
        message: 'Object storage is not configured',
      });
    }
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
