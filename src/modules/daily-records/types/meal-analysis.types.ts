import {
  buildAnalyzingMealAnalysis,
  mealAnalysisHeadline,
  mealAnalysisPayloadSchema,
  normalizeMealAnalysisDishes,
  type MealAnalysisCalorieBucket,
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
 *
 * 列表/聚合消费的是热列投影（见 [MealAnalysisHotFields]），详情消费 `payload`。
 *
 * **历史数据的表现（有意为之，非缺陷）**：v1 记录的热列都是 v1→v2 迁移时新增的，
 * 因此全部为默认值（状态/标题/热量为 null，revision 为 0），读路径按「没有分析」
 * 处理；`mealAnalysisPayloadSchema` 又要求 `version: 2`，v1 的 `mealAnalysis` 会被
 * [parseMealRecordPayload] 判为形状不匹配并置 null。结果是**迁移前已分析的餐食记录
 * 不再显示分析结果**，用户对该记录重新发起一次分析即可得到 v2 数据。
 * 不在这里做 v1→v2 回填：v1 的字段（自由形状 `mealInput`、人工确认快照）与 v2 的
 * 一次多模态直出模型没有可靠映射，猜出来的分析结论比「没有结论」更糟。
 */

export interface MealRecordPayload {
  mealAnalysis?: MealAnalysisPayload | null;
}

/** 写入 `UserDailyRecord` 的分析热列；读路径（列表、报告、助手）只认这些列。 */
export interface MealAnalysisHotFields {
  mealAnalysisStatus: MealAnalysisStatus | null;
  mealAnalysisUpdatedAt: Date | null;
  mealAnalysisFailureReason: MealAnalysisFailureReason | null;
  /** 最重要的一条结论，列表条目那一行。 */
  mealHeadline: string | null;
  mealCalorieMin: number | null;
  mealCalorieMax: number | null;
  mealCalorieBucket: MealAnalysisCalorieBucket | null;
  mealSourceRevision: number;
}

export function toMealAnalysisHotFields(
  analysis: MealAnalysisPayload | null,
): MealAnalysisHotFields {
  const range = analysis?.calorieRange ?? null;

  return {
    mealAnalysisStatus: analysis?.analysisStatus ?? null,
    mealAnalysisUpdatedAt:
      analysis?.analyzedAt != null ? new Date(analysis.analyzedAt) : null,
    mealAnalysisFailureReason: analysis?.failureReason ?? null,
    mealHeadline: mealAnalysisHeadline(analysis),
    mealCalorieMin: range?.min ?? null,
    mealCalorieMax: range?.max ?? null,
    mealCalorieBucket: range?.bucket ?? null,
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

function asPlainRecord(raw: unknown): PlainRecord | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  return raw as PlainRecord;
}
