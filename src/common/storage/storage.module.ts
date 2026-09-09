import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../config/env/env-keys.enum.js';
import { ObjectStorageRuntime } from './object-storage.runtime.js';
import { TencentCosStorageRuntime } from './tencent-cos.runtime.js';
import { S3StorageRuntime } from './s3.runtime.js';

/**
 * Provides the shared object-storage runtime to any module that needs
 * signed URLs or buffer uploads.
 *
 * Binds exactly one concrete implementation to the
 * `ObjectStorageRuntime` abstract token based on the
 * `STORAGE_PROVIDER` environment variable:
 *
 * - `s3` (default)     → `S3StorageRuntime`
 * - `tencent-cos`      → `TencentCosStorageRuntime`
 */
@Module({
  providers: [
    {
      provide: ObjectStorageRuntime,
      useFactory: (configService: ConfigService): ObjectStorageRuntime => {
        const provider = configService.get<string>(EnvKey.STORAGE_PROVIDER);
        if (provider === 's3') {
          return new S3StorageRuntime(configService);
        }
        return new TencentCosStorageRuntime(configService);
      },
      inject: [ConfigService],
    },
  ],
  exports: [ObjectStorageRuntime],
})
export class StorageModule {}
