/**
 * 一条日报记录的行投影（含附件），领域与应用层共用的数据形状。
 *
 * 这里刻意**不是** Prisma 的 `UserDailyRecordGetPayload`：读模型、presenter 与
 * 端口都在用这个形状，而只有 `infrastructure/persistence/` 允许知道 Prisma 的
 * 生成类型。日期保持 `Date`（而不是字符串），格式化成 wire 形状是 presenter 的事。
 */
import type { DailyRecordKind } from './record-kind.js';

/** 附件行（全部列都是展示用，没有领域行为）。 */
export interface RecordAttachmentRow {
  id: string;
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
  createdAt: Date;
}

/**
 * 记录行。
 *
 * `meal*` 是餐食分析的**投影列**：列表/聚合只读它们，不解析 payload JSONB。
 * 非餐食记录恒为 `null`。写入路径见 `domain/meal/meal-analysis.ts` 的
 * `mealAnalysisColumns`。
 */
export interface RecordRow {
  id: string;
  userId: string;
  healthEventId: string | null;
  kind: DailyRecordKind;
  occurredAt: Date;
  occurredTime: string | null;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  payload: unknown;
  source: string | null;
  mealAnalysisStatus: string | null;
  mealAnalysisUpdatedAt: Date | null;
  mealAnalysisFailureReason: string | null;
  mealHeadline: string | null;
  mealCalorieMin: number | null;
  mealCalorieMax: number | null;
  mealCalorieBucket: string | null;
  /** 分析幂等键：每次重新入队递增。 */
  mealSourceRevision: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  attachments: RecordAttachmentRow[];
}
