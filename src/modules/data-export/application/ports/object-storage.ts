/**
 * 对象存储端口 —— 应用层不直接依赖 `ObjectStorageRuntime`。
 *
 * `ObjectStorageRuntime` 在 `src/common/`，但它是**具象运行时**（S3/OSS/COS
 * 三选一），属于基础设施。应用层只关心三件事：配没配、上传 PDF、签下载 URL。
 */
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

/** 一次 PDF 上传的结果。 */
export interface PdfUploadResult {
  objectKey: string;
  bucket: string;
  provider: string;
  fileSizeBytes: number;
}

export abstract class ObjectStorage {
  /** 该部署是否配置了可用的对象存储后端。 */
  abstract isConfigured(): boolean;

  /**
   * 上传生成的 PDF。
   *
   * 未配置与上传失败都映射成依赖故障（`DEPENDENCY_UNAVAILABLE`），
   * 超时类保留 `DEPENDENCY_TIMEOUT`——**绝不折成内部错误**。
   */
  abstract uploadPdf(params: {
    userId: string;
    fileName: string;
    body: Buffer;
  }): ResultAsync<PdfUploadResult, DomainFailure>;

  /**
   * 为对象键签一个下载 URL。
   *
   * `objectKey` 为 `null`（请求还没产出文件）时返回 `null`——不是错误。
   */
  abstract createDownloadUrl(
    objectKey: string | null,
  ): ResultAsync<string | null, DomainFailure>;
}
