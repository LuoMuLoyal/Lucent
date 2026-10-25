/**
 * 餐食分析管线的任务类型。
 *
 * 只放**数据形状**，不放编排：编排在 `application/services/meal-analysis-pipeline.ts`，
 * 两条入站路径（队列 worker / 过期回收）与用例都引用这里。
 */

/** 一次分析作业（幂等键是 `sourceRevision`）。 */
export interface MealAnalysisJob {
  userId: string;
  recordId: string;
  sourceRevision: number;
}

/** 回收集的两个参数（由调度适配器按次读运行时配置后传入）。 */
export interface ReapSettings {
  staleAfterMs: number;
  batchSize: number;
}

/**
 * 单次分析的结局。
 *
 * 显式区分「跳过」与「写入」：队列只关心有没有落库，日志需要知道原因是
 * 「记录不见了 / revision 过期 / 不在初态 / 落库被丢弃」中的哪一种。
 */
export type AnalysisOutcome =
  | 'skipped-missing'
  | 'skipped-stale-revision'
  | 'skipped-not-analyzing'
  | 'analyzed'
  | 'failed'
  | 'discarded';
