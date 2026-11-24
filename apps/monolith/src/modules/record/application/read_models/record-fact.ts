/**
 * 跨上下文事实读模型（reader port 的返回形状 + 投影）。
 *
 * `DailyRecordFact` 的**类型**定义在 `application/ports/records-query.ts`（端口与
 * 返回形状同址）；这里只放投影函数：
 *
 * - `toDailyRecordFact` / `toDailyRecordSummaryFact`：领域行 → 事实；
 * - `toDailyRecordFactFromColumns`：仓储显式 select 出来的列 → 事实。
 *
 * 后者单独存在是因为 reader port 走显式列选择（不 include 整行），**不能**先拼一个
 * 假的 `RecordRow` 再转型——那样会悄悄依赖「没读的列恰好没用到」。
 */
import type { RecordRow } from '../../domain/record/record-row.js';
import { asDailyRecordKind } from '../../domain/record/record-kind.js';
import type {
  DailyRecordFact,
  DailyRecordSummaryFact,
} from '../ports/records-query.js';

/**
 * 投影成跨模块事实。
 *
 * 餐食投影列一并带出：跨模块消费者想知道「这条餐食分析成没成、结论是什么、区间多少」
 * 时读列即可，不必为每一行解析 `payload` JSONB。只有需要 `items` / `dishes` 明细时
 * 才读 `payload`（它与列同源）。非餐食记录这些字段恒为 `null`。
 */
export function toDailyRecordFact(row: RecordRow): DailyRecordFact {
  return {
    id: row.id,
    kind: row.kind,
    occurredAt: row.occurredAt,
    occurredTime: row.occurredTime,
    title: row.title,
    value: row.value,
    unit: row.unit,
    note: row.note,
    payload: row.payload,
    mealAnalysisStatus: row.mealAnalysisStatus,
    mealAnalysisUpdatedAt: row.mealAnalysisUpdatedAt,
    mealAnalysisFailureReason: row.mealAnalysisFailureReason,
    mealHeadline: row.mealHeadline,
    mealCalorieMin: row.mealCalorieMin,
    mealCalorieMax: row.mealCalorieMax,
    mealCalorieBucket: row.mealCalorieBucket,
    createdAt: row.createdAt,
  };
}

export function toDailyRecordSummaryFact(
  row: RecordRow,
): DailyRecordSummaryFact {
  return {
    id: row.id,
    kind: row.kind,
    occurredAt: row.occurredAt,
    occurredTime: row.occurredTime,
    title: row.title,
    value: row.value,
    unit: row.unit,
    note: row.note,
    payload: row.payload,
    attachmentCount: row.attachments.length,
    createdAt: row.createdAt,
  };
}

/** reader port 显式选择的列（与 `infrastructure/persistence/record-queries.ts` 同源）。 */
export interface RecordFactColumns {
  id: string;
  kind: string;
  occurredAt: Date;
  occurredTime: string | null;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  payload: unknown;
  mealAnalysisStatus: string | null;
  mealAnalysisUpdatedAt: Date | null;
  mealAnalysisFailureReason: string | null;
  mealHeadline: string | null;
  mealCalorieMin: number | null;
  mealCalorieMax: number | null;
  mealCalorieBucket: string | null;
  createdAt: Date;
}

/** 显式列 → 事实。未知 kind 按 `note` 收敛（库损坏时的失败方向）。 */
export function toDailyRecordFactFromColumns(
  columns: RecordFactColumns,
): DailyRecordFact {
  return {
    id: columns.id,
    kind: asDailyRecordKind(columns.kind) ?? 'note',
    occurredAt: columns.occurredAt,
    occurredTime: columns.occurredTime,
    title: columns.title,
    value: columns.value,
    unit: columns.unit,
    note: columns.note,
    payload: columns.payload,
    mealAnalysisStatus: columns.mealAnalysisStatus,
    mealAnalysisUpdatedAt: columns.mealAnalysisUpdatedAt,
    mealAnalysisFailureReason: columns.mealAnalysisFailureReason,
    mealHeadline: columns.mealHeadline,
    mealCalorieMin: columns.mealCalorieMin,
    mealCalorieMax: columns.mealCalorieMax,
    mealCalorieBucket: columns.mealCalorieBucket,
    createdAt: columns.createdAt,
  };
}
