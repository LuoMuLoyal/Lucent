import { Module } from '@nestjs/common';
import { CosStorageRuntime } from './cos-storage.runtime';

/**
 * Provides the shared COS storage runtime to any module that needs
 * signed URLs or buffer uploads to Tencent Cloud Object Storage.
 */
@Module({
  providers: [CosStorageRuntime],
  exports: [CosStorageRuntime],
})
export class StorageModule {}
