/**
 * 导出队列端口 —— 应用层不依赖 BullMQ 或队列注册表。
 *
 * ## 为什么端口只有两个方法
 *
 * 应用层只需要「队列能用吗」与「投一个任务进去」。重试策略、退避、保留条数
 * 都是队列实现的事（`adapters/queue/export-queue.ts`）。
 */
export interface ExportJob {
  exportRequestId: string;
  userId: string;
  language: string;
}

export abstract class ExportQueue {
  /** 该部署是否配置了队列（未配置时调用方走同步内联处理）。 */
  abstract get isConfigured(): boolean;

  /**
   * 投递一个导出任务。
   *
   * @throws 队列不可用或投递失败时拒绝——调用方据此回退到同步处理。
   */
  abstract enqueue(job: ExportJob): Promise<void>;
}
