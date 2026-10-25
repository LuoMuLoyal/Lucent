/**
 * 图片签名读地址端口的存储运行时适配。
 *
 * 存储运行时（`ObjectStorageRuntime`）本身是基础设施；应用层只认识
 * 「把对象键换成外部可读 URL」这一个语义，所以这里做一次收敛。
 */
import { Injectable } from '@nestjs/common';
import { ObjectStorageRuntime } from '../../../../common/index.js';
import { AttachmentUrls } from '../../application/ports/attachment-urls.js';

@Injectable()
export class StorageAttachmentUrls extends AttachmentUrls {
  constructor(private readonly runtime: ObjectStorageRuntime) {
    super();
  }

  async signedGetUrl(objectKey: string): Promise<string> {
    return this.runtime.createSignedGetUrl({
      objectKey,
      audience: 'external',
    });
  }
}
