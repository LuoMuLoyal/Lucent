import {
  buildAnalyzingMealAnalysis,
  mealAnalysisHeadline,
  mealAnalysisPayloadSchema,
  normalizeMealAnalysisDishes,
  type MealAnalysisFailureReason,
  type MealAnalysisPayload,
  type MealAnalysisStatus,
} from '../schemas/meal-analysis.schema.js';

/**
 * 餐食记录的 payload 读写路径。
 *
 * v2 起 `payload` 只有 `mealAnalysis` 一个键：v1 的 `mealInput`（客户端自由形状）
 * 与 `mealAnalysisLastConfirmed`（人工确认快照）随确认步骤一起删除，菜名改为
 * `mealAnalysis.dishes`（客户端唯一可编辑的字段，`source: 'user'` 标记）。
 *
 * `mealAnalysis` 的其余字段一律服务端所有：客户端提交里出现的 `items` /
 * `calorieRange` / `analysisStatus` / `sourceRevision` 全部被忽略。
 */

export interface MealRecordPayload {
  mealAnalysis?: MealAnalysisPayload | null;
}

export interface MealListSummary {
  mealAnalysisStatus: MealAnalysisStatus | null;
  mealAnalysisUpdatedAt: string | null;
  mealAnalysisFailureReason: MealAnalysisFailureReason | null;
  /** 列表条目那一行：最重要的结论（P0-2 投影为 `mealHeadline`）。 */
  mealShortDescription: string | null;
  /** 菜名（列表条目不用；助手摘要与编辑页用）。 */
  mealTopFoods: string[];
}

/** 写入 `UserDailyRecord` 的分析热列（列表/报告只读这些列，不解析 payload）。 */
export interface MealAnalysisHotFields {
  mealAnalysisStatus: MealAnalysisStatus | null;
  mealAnalysisCoverage: null;
  mealAnalysisUpdatedAt: Date | null;
  mealAnalysisFailureReason: MealAnalysisFailureReason | null;
  mealSourceRevision: number;
}

export function toMealAnalysisHotFields(
  analysis: MealAnalysisPayload | null,
): MealAnalysisHotFields {
  return {
    mealAnalysisStatus: analysis?.analysisStatus ?? null,
    // coverage 概念已删除，列随投影切片一并移除。
    mealAnalysisCoverage: null,
    mealAnalysisUpdatedAt:
      analysis?.analyzedAt != null ? new Date(analysis.analyzedAt) : null,
    mealAnalysisFailureReason: analysis?.failureReason ?? null,
    mealSourceRevision: analysis?.sourceRevision ?? 0,
  };
}

type PlainRecord = Record<string, unknown>;

export function parseMealRecordPayload(raw: unknown): MealRecordPayload {
  const root = asPlainRecord(raw);
  if (root == null) {
    return {};
  }

  // 契约校验是唯一入口：形状不匹配（旧记录、部分写入）时按「没有分析」处理，
  // 而不是把半截对象交给读路径——消费方无法判断哪些字段可信，缺字段还会炸。
  const validated = mealAnalysisPayloadSchema
    .nullable()
    .safeParse(root['mealAnalysis']);

  return { mealAnalysis: validated.success ? validated.data : null };
}

/**
 * 客户端可提交的唯一餐食字段是菜名列表：`{ mealAnalysis: { dishes: [{ name }] } }`。
 *
 * - 没有分析结果时没有可编辑的菜名，客户端提交被忽略（payload 保持为空）。
 * - 编辑后整份菜名列表都标记为 `user`（不保留逐条来源差异，见计划决策 3）。
 * - 改菜名**不重算** `items` / `calorieRange`，也不触发重新分析。
 */
export function buildMealPayloadFromClientInput(
  clientPayload: unknown,
  existingPayload: unknown,
): PlainRecord | null {
  const existing = parseMealRecordPayload(existingPayload).mealAnalysis ?? null;
  if (existing == null) {
    return null;
  }

  const clientAnalysis = asPlainRecord(
    asPlainRecord(clientPayload)?.['mealAnalysis'],
  );
  const submittedDishes = clientAnalysis?.['dishes'];
  if (!Array.isArray(submittedDishes)) {
    return { mealAnalysis: existing };
  }

  const dishes = normalizeMealAnalysisDishes(
    submittedDishes.map((dish) => ({
      name: asPlainRecord(dish)?.['name'],
      source: 'user' as const,
    })),
  );

  return { mealAnalysis: { ...existing, dishes } };
}

/** 入队占位：状态置 `analyzing` 并把 `sourceRevision` 递增（幂等靠它）。 */
export function markMealAnalysisQueued(rawPayload: unknown): PlainRecord {
  const previous = parseMealRecordPayload(rawPayload).mealAnalysis ?? null;

  return {
    mealAnalysis: buildAnalyzingMealAnalysis({
      sourceRevision: (previous?.sourceRevision ?? 0) + 1,
    }),
  };
}

export function getMealSourceRevision(rawPayload: unknown): number {
  return parseMealRecordPayload(rawPayload).mealAnalysis?.sourceRevision ?? 0;
}

export function getMealListSummary(rawPayload: unknown): MealListSummary {
  const analysis = parseMealRecordPayload(rawPayload).mealAnalysis ?? null;

  return {
    mealAnalysisStatus: analysis?.analysisStatus ?? null,
    mealAnalysisUpdatedAt: analysis?.analyzedAt ?? null,
    mealAnalysisFailureReason: analysis?.failureReason ?? null,
    mealShortDescription: mealAnalysisHeadline(analysis),
    mealTopFoods: (analysis?.dishes ?? []).map((dish) => dish.name).slice(0, 3),
  };
}

function asPlainRecord(raw: unknown): PlainRecord | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  return raw as PlainRecord;
}
