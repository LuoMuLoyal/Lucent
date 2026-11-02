/**
 * 餐食分析入队端口。
 *
 * 应用层只知道「有个作业要跑」，不知道它落在 BullMQ、内存队列还是同步执行——
 * 那三种形态的差异（含「Redis 断连时回退同步」）是队列适配器的事。
 */
export interface MealAnalysisJob {
  userId: string;
  recordId: string;
  /** 幂等键：worker 只处理 revision 与库里一致的那一条。 */
  sourceRevision: number;
}

export abstract class MealAnalysisJobs {
  /**
   * 提交一个分析作业。
   *
   * 实现**必须**在队列不可用时退化为同步执行，而不是把异常抛给请求方：
   * 队列是性能优化，不是业务前置条件。
   */
  abstract enqueue(job: MealAnalysisJob): Promise<void>;
}
