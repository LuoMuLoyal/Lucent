/**
 * 记录行与 Prisma 生成类型之间的边界。
 *
 * 这是**唯一**允许知道 Prisma 行形状的文件之一（另一个是仓储实现本身）：
 * 领域层用 `RecordRow`（`domain/record/record-row.ts`），Prisma 用
 * `UserDailyRecordGetPayload`，两者在这里互转。
 *
 * 为什么要转而不是直接用 Prisma 类型：`ddd-application-no-direct-prisma` 禁止
 * `application/**` import 生成物；而读模型与 presenter 都消费 `RecordRow`。
 * 显式写一遍列，也顺带让「新增列」变成一次编译错误而不是静默漏读。
 */
import {
  type DailyRecordAttachmentKind,
  type DailyRecordKind,
  Prisma,
} from '#generated/prisma/client.js';
import { asDailyRecordKind } from '../../domain/record/record-kind.js';
import type {
  RecordAttachmentRow,
  RecordRow,
} from '../../domain/record/record-row.js';

/** 列表/详情都需要的附件 include（附件按创建时间升序）。 */
export const recordWithAttachments = {
  attachments: { orderBy: { createdAt: Prisma.SortOrder.asc } },
} satisfies Prisma.UserDailyRecordInclude;

export type RecordDbRow = Prisma.UserDailyRecordGetPayload<{
  include: typeof recordWithAttachments;
}>;

/** Prisma 行 → 领域行。未知 kind 一律按 `note` 收敛（不该发生的库损坏）。 */
export function toRecordRow(row: RecordDbRow): RecordRow {
  return {
    id: row.id,
    userId: row.userId,
    healthEventId: row.healthEventId,
    kind: asDailyRecordKind(row.kind) ?? 'note',
    occurredAt: row.occurredAt,
    occurredTime: row.occurredTime,
    title: row.title,
    value: row.value,
    unit: row.unit,
    note: row.note,
    payload: row.payload,
    source: row.source,
    mealAnalysisStatus: row.mealAnalysisStatus,
    mealAnalysisUpdatedAt: row.mealAnalysisUpdatedAt,
    mealAnalysisFailureReason: row.mealAnalysisFailureReason,
    mealHeadline: row.mealHeadline,
    mealCalorieMin: row.mealCalorieMin,
    mealCalorieMax: row.mealCalorieMax,
    mealCalorieBucket: row.mealCalorieBucket,
    mealSourceRevision: row.mealSourceRevision,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    attachments: row.attachments.map(
      (attachment): RecordAttachmentRow => ({
        id: attachment.id,
        kind: attachment.kind,
        objectKey: attachment.objectKey,
        bucket: attachment.bucket,
        provider: attachment.provider,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        width: attachment.width,
        height: attachment.height,
        publicUrl: attachment.publicUrl,
        createdAt: attachment.createdAt,
      }),
    ),
  };
}

/** 领域 kind → Prisma enum 值（两边取值逐字一致，转它是为了类型收窄）。 */
export function toDbKind(kind: string): DailyRecordKind {
  return kind as DailyRecordKind;
}

/** 领域附件 kind → Prisma enum 值。 */
export function toDbAttachmentKind(kind: string): DailyRecordAttachmentKind {
  return kind as DailyRecordAttachmentKind;
}
