import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { ResultCode } from '../../../common/api';
import { now } from '../../../common/helpers/date-time.utils';
import { DataExportCosRuntime } from '../config/cos.runtime';

const PROVIDER = 'tencent-cos';

@Injectable()
export class DataExportStorageService {
  constructor(private readonly runtime: DataExportCosRuntime) {}

  isConfigured(): boolean {
    const config = this.runtime.getConfig();
    return Boolean(
      config.secretId && config.secretKey && config.bucket && config.region,
    );
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

    return {
      objectKey,
      bucket: this.runtime.getConfig().bucket,
      provider: PROVIDER,
      fileSizeBytes: params.body.byteLength,
    };
  }

  createDownloadUrl(objectKey: string | null): string | null {
    if (!objectKey || !this.isConfigured()) {
      return null;
    }

    return this.runtime.createSignedGetUrl(objectKey);
  }

  private assertConfigured(): void {
    if (this.isConfigured()) {
      return;
    }

    throw new ServiceUnavailableException({
      code: ResultCode.EXTERNAL_SERVICE_ERROR,
      message: 'Tencent COS export storage is not configured',
    });
  }

  private createObjectKey(userId: string, fileName: string): string {
    const currentTime = now();
    const year = String(currentTime.getUTCFullYear());
    const month = String(currentTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(currentTime.getUTCDate()).padStart(2, '0');
    const extension = this.resolveExtension(fileName);

    return `exports/${userId}/${year}/${month}/${day}/${randomUUID()}${extension}`;
  }

  private resolveExtension(fileName: string): string {
    const originalExt = extname(fileName).toLowerCase();
    if (originalExt === '.pdf') {
      return originalExt;
    }

    return '.pdf';
  }
}
