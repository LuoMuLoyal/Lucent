import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../config/env/env-keys.enum';
import { ObjectStorageRuntime } from './object-storage.runtime';
import { TencentCosStorageRuntime } from './tencent-cos.runtime';
import { S3StorageRuntime } from './s3.runtime';

/**
 * Provides the shared object-storage runtime to any module that needs
 * signed URLs or buffer uploads.
 *
 * Binds exactly one concrete implementation to the
 * `ObjectStorageRuntime` abstract token based on the
 * `STORAGE_PROVIDER` environment variable:
 *
 * - `tencent-cos` (default) → `TencentCosStorageRuntime`
 * - `s3`                    → `S3StorageRuntime`
 */
@Module({
  providers: [
    {
      provide: ObjectStorageRuntime,
      useFactory: (configService: ConfigService): ObjectStorageRuntime => {
        const provider =
          configService.get<string>(EnvKey.STORAGE_PROVIDER) ?? 'tencent-cos';
        if (provider === 's3') {
          return new S3StorageRuntime(configService);
        }
        if (provider === 'tencent-cos') {
          return new TencentCosStorageRuntime(configService);
        }
        throw new Error(
          `STORAGE_PROVIDER "${provider}" is not supported. ` +
            'Use "tencent-cos" or "s3".',
        );
      },
      inject: [ConfigService],
    },
  ],
  exports: [ObjectStorageRuntime],
})
export class StorageModule {}
