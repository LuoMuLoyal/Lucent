/**
 * 记录 payload 的写路径规则（纯函数，无 DI）。
 *
 * 两件事：
 *
 * 1. **餐食 payload 的写入形状**：客户端的提交只能改 `dishes`；
 *    `analysisStatus` 永远由服务端（入队 / worker）写。
 * 2. **餐食热列投影**：把 payload 里的分析折成记录行上的投影列——列表/聚合/报告
 *    都只读列，不解析 JSONB。
 */
import type { RecordWriteValues } from '../../domain/record/records.js';
import {
  buildMealPayloadFromClientInput,
  getMealSourceRevision,
  markMealAnalysisQueued,
  parseMealRecordPayload,
  toMealAnalysisColumns,
  type MealAnalysisColumns,
} from '../../domain/meal/meal-analysis.js';

/**
 * 准备要写入的餐食 payload。
 *
 * 恰好一张图 = 新建分析或「重新分析」：状态置 `analyzing` 并把 revision 递增；
 * 0 张（纯手写记录）或多张（无法分析）都只保留清洗后的菜名。
 */
export function prepareMealPayload(
  payload: unknown,
  attachments: ReadonlyArray<{ objectKey: string }> | undefined,
  existingPayload?: unknown,
): Record<string, unknown> | null {
  const sanitized = buildMealPayloadFromClientInput(
    payload,
    existingPayload ?? null,
  );
  if (attachments == null || attachments.length !== 1) {
    return sanitized;
  }
  return markMealAnalysisQueued(sanitized);
}

/** payload → 投影列（没有分析时全是 null，revision 归 0）。 */
export function mealAnalysisColumns(payload: unknown): MealAnalysisColumns {
  return toMealAnalysisColumns(
    parseMealRecordPayload(payload).mealAnalysis ?? null,
  );
}

/**
 * 把餐食 payload 折进记录的写数据：payload 本体 + 投影列。
 *
 * `payload` 为 `null` 表示本次不写餐食字段（非餐食更新、或没有分析可写）。
 */
export function withMealColumns(
  values: RecordWriteValues,
  mealPayload: Record<string, unknown> | null,
): RecordWriteValues {
  if (mealPayload == null) {
    return values;
  }
  return {
    ...values,
    payload: mealPayload,
    ...mealAnalysisColumns(mealPayload),
  };
}

/**
 * 写完是否需要入队分析。
 *
 * `sourceRevisionOverride` 用于「payload 已在事务里写好」的路径（新建/替换图片）：
 * 那时状态已经落成 `analyzing`，不能靠 status 判断，直接用刚写的 revision。
 */
export function analysisRevisionToQueue(
  recordKind: string,
  attachmentCount: number,
  payload: Record<string, unknown> | null | undefined,
  sourceRevisionOverride?: number,
): number | null {
  if (recordKind !== 'meal' || attachmentCount !== 1) {
    return null;
  }
  if (sourceRevisionOverride != null) {
    return sourceRevisionOverride;
  }

  const analysis = payload?.['mealAnalysis'] as
    | Record<string, unknown>
    | undefined;
  if (analysis?.['analysisStatus'] !== 'analyzing') {
    return null;
  }
  return getMealSourceRevision(payload);
}
