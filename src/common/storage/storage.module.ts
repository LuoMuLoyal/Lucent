import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../config/env/config-keys.enum';
import type { YamlConfig } from '../../config/yaml/yaml-loader';
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
        const yaml = configService.getOrThrow<YamlConfig>(ConfigKey.Yaml);
        const provider = yaml.storage.provider;
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
