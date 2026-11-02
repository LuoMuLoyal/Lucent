/**
 * 餐食 payload 的读侧辅助 —— 兼容入口。
 *
 * 规则与实现已迁到领域层（`domain/meal/meal-analysis.ts`）：v2 起 `payload` 只有
 * `mealAnalysis` 一个键，客户端唯一可编辑的是 `dishes`，其余字段服务端独占。
 * 这里只保留再导出，供本模块内的写路径与 spec 使用。
 */
export {
  buildAnalyzingMealAnalysis,
  buildFailedMealAnalysis,
  buildMealPayloadFromClientInput,
  getMealSourceRevision,
  markMealAnalysisQueued,
  mealAnalysisHeadline,
  normalizeMealAnalysis,
  normalizeMealAnalysisDishes,
  parseMealRecordPayload,
  toMealAnalysisColumns as toMealAnalysisHotFields,
} from '../../domain/meal/meal-analysis.js';
export type {
  MealAnalysisCalorieBucket,
  MealAnalysisFailureReason,
  MealAnalysisPayload,
  MealAnalysisStatus,
  MealAnalysisColumns as MealAnalysisHotFields,
  MealRecordPayload,
} from '../../domain/meal/meal-analysis.js';
