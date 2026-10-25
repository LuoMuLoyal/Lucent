/**
 * 待分析餐食的载入端口（读侧，供分析管线使用）。
 *
 * 与 `DailyRecords`（写侧写模型）分开：分析管线只读记录、只按 revision 条件写，
 * 它不需要也不该拿到通用的写端口。
 *
 * ## 两条不变量由这个端口支撑
 *
 * - **写回前复检 revision**：`writeAnalysis` 的 `where` 带 `sourceRevision`，
 *   分析期间用户再编辑（重新入队会让 revision 递增）时，本次旧结果自动丢弃。
 * - **失败必须落库**：调用方拿不到结果也要写 `analysis_failed` + 原因码，
 *   端口提供 `markAnalysisFailed` 作为唯一失败写入口。
 */
import type { MealAnalysisPayload } from './meal-analysis.js';

/** 一条待分析记录的载入快照。 */
export interface MealAnalysisCandidate {
  id: string;
  userId: string;
  /** 全部附件（分析只在恰好一张图时成立，判定在应用层）。 */
  attachmentObjectKeys: string[];
  /** 当前 revision（作业幂等键）。 */
  sourceRevision: number;
  /** 用户语言（`null` 表示未设置，调用方按产品主语言兜底）。 */
  locale: string | null;
  /** payload 里现有的分析（形状不合契约时为 `null`）。 */
  analysis: MealAnalysisPayload | null;
}

/** 过期 `analyzing` 的候选（回收器用）。 */
export interface StaleMealAnalysisCandidate {
  id: string;
  userId: string;
  sourceRevision: number;
  locale: string | null;
}

export abstract class MealAnalyses {
  /** 逐条加载待分析记录；不存在 / 不是餐食 / 已删除时返回 `null`。 */
  abstract findCandidate(
    recordId: string,
  ): Promise<MealAnalysisCandidate | null>;

  /**
   * 条件写：仅当记录的 `mealSourceRevision` 仍等于 `sourceRevision` 时落库。
   * 返回是否写入（`false` = 分析期间被重新编辑过，本次结果作废）。
   */
  abstract writeAnalysis(
    recordId: string,
    sourceRevision: number,
    analysis: MealAnalysisPayload,
  ): Promise<boolean>;

  /**
   * 落失败终态（`analysis_failed` + 原因码）。同样按 revision 条件写，
   * 避免把「已重新入队的记录」标成失败。
   */
  abstract markAnalysisFailed(
    recordId: string,
    sourceRevision: number,
    analysis: MealAnalysisPayload,
  ): Promise<boolean>;

  /**
   * 列出停留在 `analyzing` 且超过 `staleBefore` 的餐食记录（回收器用）。
   *
   * `staleBefore` 由调用方按运行时配置算出：本端口不认识配置来源。
   */
  abstract listStaleAnalyzing(
    staleBefore: Date,
    batchSize: number,
  ): Promise<StaleMealAnalysisCandidate[]>;
}
