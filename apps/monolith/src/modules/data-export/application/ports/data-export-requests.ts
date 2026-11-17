/**
 * 数据导出请求的仓储端口 —— 应用层不碰 Prisma。
 *
 * ## 为什么需要这个端口
 *
 * 四层迁移前，`DataExportService` / `ProcessExport` 直接注入
 * `PrismaService` 读写 `data_export_requests`。`pnpm arch:check` 的
 * `ddd-application-no-direct-prisma` 会拦（禁止 `application/**` import
 * `@prisma/client` 或 `src/prisma/**`）。
 *
 * ## 为什么端口里的形状是「读模型行」而不是实体
 *
 * 导出请求没有值得建模的不变量——它就是一条状态机记录（`pending` →
 * `processing` → `completed` / `failed` / `unavailable`），状态转移由队列
 * 与处理流程驱动，不需要聚合根守着。所以端口直接暴露读写行的动作。
 */

/** 导出请求的状态。 */
export type DataExportStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'unavailable';

/** 一条导出请求（读侧形状）。 */
export interface DataExportRequestRow {
  id: string;
  kind: string;
  format: string;
  range: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  downloadUrl: string | null;
  objectKey: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
}

/** 创建一条请求的输入。 */
export interface NewDataExportRequest {
  userId: string;
  kind: string;
  format: string;
  range: string;
  status: DataExportStatus;
  errorMessage?: string;
}

/** 完成/失败时写回的字段。 */
export interface DataExportCompletion {
  status: DataExportStatus;
  objectKey?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  errorMessage?: string | null;
  completedAt?: Date | null;
}

/**
 * 导出请求仓储端口。
 *
 * 方法返回 Promise：失败以异常抛出，由应用层映射成 `DomainFailure`
 * （与 `Sessions` / `Accounts` 端口同一约定）。
 */
export abstract class DataExportRequests {
  /** 创建一条请求并返回它。 */
  abstract create(input: NewDataExportRequest): Promise<DataExportRequestRow>;

  /** 按 id 取请求；查不到返回 `null`。 */
  abstract findById(id: string): Promise<DataExportRequestRow | null>;

  /** 取该用户最近一条请求；没有返回 `null`。 */
  abstract findLatestByUser(
    userId: string,
  ): Promise<DataExportRequestRow | null>;

  /** 把请求标记为 `processing`（清空上一次的错误）。 */
  abstract markProcessing(id: string): Promise<void>;

  /** 写回完成/失败状态。 */
  abstract complete(id: string, patch: DataExportCompletion): Promise<void>;
}
