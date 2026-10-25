/**
 * 日报记录仓储端口（写侧聚合加载 / 保存）。
 *
 * ## 形状
 *
 * 端口只暴露**语义完整的写操作**，不暴露查询 DSL：读路径走
 * `application/ports/records-query.ts` 的查询端口与 `application/read_models/`，
 * 那些不受这里约束。
 *
 * ## 为什么用 `RecordRow` 而不是 Prisma 类型
 *
 * `ddd-application-no-direct-prisma` 禁止 `application/**` import Prisma；
 * 若端口签名里出现 `Prisma.UserDailyRecordCreateInput`，应用层就会被迫 import
 * 生成物。这里给出一个**只含数据列**的结构（`RecordRow`），Prisma 实现负责把它
 * 与生成类型互转（`infrastructure/persistence/` 是唯一知道 Prisma 形状的地方）。
 *
 * ## 为什么 `RecordRow.input` 是 `unknown`
 *
 * `id` / `createdAt` / `updatedAt` 由数据库生成，`id` 还要在同一次调用里回读。
 * 端口把「写什么」与「回读什么」分开：`input` 是数据列，读回的方法都返回
 * `RecordRow`。领域层不解释 payload，只当不透明值透传。
 */
import type { DailyRecordKind } from '../record/record-kind.js';
import type { RecordRow } from './record-row.js';

/** 列表 / 汇总读需要的过滤条件。 */
export interface RecordListFilter {
  userId: string;
  occurredAt: Date;
  kind?: DailyRecordKind;
}

/** 分页参数。 */
export interface RecordPage {
  page: number;
  pageSize: number;
}

/** 一页记录 + 总数。 */
export interface RecordPageResult {
  items: RecordRow[];
  total: number;
}

/** 归属判定只需要这几个字段。 */
export interface RecordOwnershipRow {
  userId: string;
  kind: DailyRecordKind;
  payload: unknown;
  occurredAt: Date;
}

/** 一行的写数据列（`id`/时间戳不入内，`null` 表示显式清空）。 */
export type RecordWriteValues = Record<string, unknown>;

/** 一条附件的写数据（`id`/`createdAt` 由数据库生成）。 */
export interface AttachmentWriteValues {
  userId: string;
  recordId: string;
  kind: string;
  objectKey: string;
  bucket: string | null;
  provider: string | null;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  publicUrl: string | null;
}

export abstract class DailyRecords {
  /** 按日（可选按 kind）分页列出，排序 `occurredTime desc nulls last, createdAt desc`。 */
  abstract listPage(
    filter: RecordListFilter,
    page: RecordPage,
  ): Promise<RecordPageResult>;

  /** 列出某一天的全部记录（汇总用，不分页）。 */
  abstract listByDay(userId: string, occurredAt: Date): Promise<RecordRow[]>;

  /** 按 id 读一条（含附件），不校验归属。 */
  abstract findById(id: string): Promise<RecordRow | null>;

  /** 读归属判定所需的最小投影；记录不存在（或已软删）返回 `null`。 */
  abstract findOwnership(id: string): Promise<RecordOwnershipRow | null>;

  /** 新建一条记录并读回（含附件）。 */
  abstract insert(values: RecordWriteValues): Promise<RecordRow>;

  /** 局部更新并读回（含附件）。 */
  abstract update(id: string, values: RecordWriteValues): Promise<RecordRow>;

  /**
   * 整体替换附件集（先清空再写入；空数组即清空）。
   *
   * 只作为事务内的一步使用：附件替换与记录更新要么一起成功、要么一起回滚。
   */
  abstract replaceAttachments(
    userId: string,
    recordId: string,
    attachments: AttachmentWriteValues[],
  ): Promise<void>;

  /** 软删除；记录已被删除时返回 `false` 而不是报错。 */
  abstract softDelete(id: string, deletedAt: Date): Promise<boolean>;

  /**
   * 在一个事务里执行 `fn`；`fn` 拿到的端口**只做本次事务内的写**。
   *
   * WARNING: `fn` 内不得调用任何会自带事务的方法（Prisma 的嵌套事务会静默退化成
   * 独立连接，丢掉原子性）。副作用（入队、缓存失效）必须留在 `fn` 之外。
   */
  abstract transaction<T>(fn: (tx: DailyRecords) => Promise<T>): Promise<T>;
}
